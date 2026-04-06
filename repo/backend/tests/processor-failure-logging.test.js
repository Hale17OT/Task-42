const { pool } = require("../src/db/pool");
const logger = require("../src/logger");

// Mock dependencies before loading processor
const queueServicePath = require.resolve("../src/modules/queue/queue.service");
const ordersServicePath = require.resolve("../src/modules/orders/orders.service");
const paymentsServicePath = require.resolve("../src/modules/payments/payments.service");
const ingestionServicePath = require.resolve("../src/modules/ingestion/ingestion.service");
const auditLogPath = require.resolve("../src/services/audit-log");
const processorPath = require.resolve("../src/modules/payments/processor.service");

const mockedClaimRunnableJobs = vi.fn();
const mockedMarkJobCompleted = vi.fn();
const mockedMarkJobFailed = vi.fn();
const mockedRequeueStaleRunningJobs = vi.fn();
const mockedEnqueueJob = vi.fn();
const mockedLogIngestionEvent = vi.fn();
const mockedHandleIngestionProcessFileJob = vi.fn();

function setup() {
  delete require.cache[processorPath];

  require.cache[queueServicePath] = {
    id: queueServicePath,
    filename: queueServicePath,
    loaded: true,
    exports: {
      claimRunnableJobs: mockedClaimRunnableJobs,
      markJobCompleted: mockedMarkJobCompleted,
      markJobFailed: mockedMarkJobFailed,
      requeueStaleRunningJobs: mockedRequeueStaleRunningJobs,
      enqueueJob: mockedEnqueueJob
    }
  };

  require.cache[ordersServicePath] = {
    id: ordersServicePath,
    filename: ordersServicePath,
    loaded: true,
    exports: { cancelUnpaidOrder: vi.fn() }
  };

  require.cache[paymentsServicePath] = {
    id: paymentsServicePath,
    filename: paymentsServicePath,
    loaded: true,
    exports: { applyPaymentRecordJob: vi.fn() }
  };

  require.cache[ingestionServicePath] = {
    id: ingestionServicePath,
    filename: ingestionServicePath,
    loaded: true,
    exports: {
      enqueueIngestionScanJob: vi.fn(),
      handleIngestionScanSourcesJob: vi.fn(),
      handleIngestionProcessFileJob: mockedHandleIngestionProcessFileJob,
      logIngestionEvent: mockedLogIngestionEvent
    }
  };

  require.cache[auditLogPath] = {
    id: auditLogPath,
    filename: auditLogPath,
    loaded: true,
    exports: { writeAuditEvent: vi.fn() }
  };

  return require("../src/modules/payments/processor.service");
}

describe("Processor failure and retry logging", () => {
  let processor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequeueStaleRunningJobs.mockResolvedValue(undefined);
    mockedMarkJobCompleted.mockResolvedValue(undefined);
    mockedMarkJobFailed.mockResolvedValue(undefined);
    mockedLogIngestionEvent.mockResolvedValue(undefined);
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    processor = setup();
  });

  afterEach(() => {
    logger.error.mockRestore?.();
    logger.warn.mockRestore?.();
  });

  afterAll(() => {
    delete require.cache[processorPath];
    delete require.cache[queueServicePath];
    delete require.cache[ordersServicePath];
    delete require.cache[paymentsServicePath];
    delete require.cache[ingestionServicePath];
    delete require.cache[auditLogPath];
  });

  test("ingestion job failure logs retry event when retries remain", async () => {
    mockedClaimRunnableJobs.mockResolvedValue([{
      id: 10,
      jobType: "ingestion_process_file",
      payload: { sourceId: 5, filePath: "/tmp/test.json" },
      attempts: 0,
      maxAttempts: 3
    }]);

    mockedHandleIngestionProcessFileJob.mockRejectedValue(new Error("parse failed"));

    await processor.processQueueTick(1);

    // Should log a retry event
    expect(mockedLogIngestionEvent).toHaveBeenCalledTimes(1);
    const logCall = mockedLogIngestionEvent.mock.calls[0][0];
    expect(logCall.sourceId).toBe(5);
    expect(logCall.logType).toBe("retried");
    expect(logCall.logMessage).toContain("retry");

    // Should also call markJobFailed
    expect(mockedMarkJobFailed).toHaveBeenCalledTimes(1);
    expect(mockedMarkJobFailed.mock.calls[0][1]).toBe("parse failed");
  });

  test("ingestion job final failure logs failed event", async () => {
    mockedClaimRunnableJobs.mockResolvedValue([{
      id: 11,
      jobType: "ingestion_process_file",
      payload: { sourceId: 5, filePath: "/tmp/test.json" },
      attempts: 2,
      maxAttempts: 3
    }]);

    mockedHandleIngestionProcessFileJob.mockRejectedValue(new Error("permanent fail"));

    await processor.processQueueTick(1);

    expect(mockedLogIngestionEvent).toHaveBeenCalledTimes(1);
    const logCall = mockedLogIngestionEvent.mock.calls[0][0];
    expect(logCall.logType).toBe("failed");
    expect(logCall.logMessage).toContain("permanently");
  });

  test("non-ingestion job failure does not log ingestion event", async () => {
    mockedClaimRunnableJobs.mockResolvedValue([{
      id: 12,
      jobType: "cancel_unpaid_order",
      payload: { orderId: 1 },
      attempts: 0,
      maxAttempts: 3
    }]);

    require.cache[ordersServicePath].exports.cancelUnpaidOrder.mockRejectedValue(new Error("db down"));

    await processor.processQueueTick(1);

    expect(mockedLogIngestionEvent).not.toHaveBeenCalled();
    expect(mockedMarkJobFailed).toHaveBeenCalledTimes(1);
  });

  test("successful job marks completed without calling markJobFailed", async () => {
    mockedClaimRunnableJobs.mockResolvedValue([{
      id: 13,
      jobType: "ingestion_process_file",
      payload: { sourceId: 5, filePath: "/tmp/ok.json" },
      attempts: 0,
      maxAttempts: 3
    }]);

    mockedHandleIngestionProcessFileJob.mockResolvedValue(undefined);

    await processor.processQueueTick(1);

    expect(mockedMarkJobCompleted).toHaveBeenCalledWith(13);
    expect(mockedMarkJobFailed).not.toHaveBeenCalled();
  });

  test("compensation/noop jobs are acknowledged without error", async () => {
    mockedClaimRunnableJobs.mockResolvedValue([{
      id: 14,
      jobType: "payment_compensation_review",
      payload: {},
      attempts: 0,
      maxAttempts: 1
    }]);

    await processor.processQueueTick(1);

    expect(mockedMarkJobCompleted).toHaveBeenCalledWith(14);
    expect(mockedMarkJobFailed).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
