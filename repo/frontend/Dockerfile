FROM node:20-alpine

WORKDIR /app

# Skip Playwright browser download at install time — browsers are only needed
# for E2E tests which are run separately with a browser-enabled image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

COPY package.json ./
RUN npm install --no-audit --no-fund --ignore-scripts

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
