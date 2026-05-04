import axios from "axios";
import axiosRetry from "axios-retry";
import https from "node:https";
import { logger } from "./logger";

export const $axios = axios.create({
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
  }),
});

axiosRetry($axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  onRetry: (retryCount, error, requestConfig) => {
    logger.warn(
      { retryCount, error: error.message, url: requestConfig.url },
      "retrying request"
    );
  },
});

$axios.interceptors.request.use((config) => {
  logger.debug({ method: config.method, url: config.url }, "sending request");
  return config;
});

$axios.interceptors.response.use(
  (response) => {
    logger.debug({ status: response.status, url: response.config.url }, "request resolved");
    return response;
  },
  (error) => {
    logger.error(
      { error: error.message, status: error.response?.status, url: error.config?.url },
      "request rejected"
    );
    return Promise.reject(error);
  }
);
