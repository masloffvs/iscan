import axios, { AxiosInstance, CreateAxiosDefaults } from "axios";
import axiosRetry from "axios-retry";
import https from "node:https";
import { logger } from "./logger";

function createAxiosInstance(config?: CreateAxiosDefaults): AxiosInstance {
  const instance = axios.create({
    timeout: 15000,
    headers: {
      "Content-Type": "application/json",
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    ...config,
  });

  axiosRetry(instance, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    onRetry: (retryCount, error, requestConfig) => {
      logger.warn(
        { retryCount, error: error.message, url: requestConfig.url },
        "retrying request"
      );
    },
  });

  instance.interceptors.request.use((reqConfig) => {
    logger.debug({ method: reqConfig.method, url: reqConfig.url }, "sending request");
    return reqConfig;
  });

  instance.interceptors.response.use(
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

  return instance;
}

export const $axiosRegistry = new Map<string, AxiosInstance>();

const defaultInstance = createAxiosInstance();

export interface ExtendedAxiosInstance extends AxiosInstance {
  use(instanceId: string): AxiosInstance;
  with(config: { instanceId: string } & CreateAxiosDefaults): AxiosInstance;
}

export const $axios = Object.assign(defaultInstance, {
  use(instanceId: string): AxiosInstance {
    const instance = $axiosRegistry.get(instanceId);
    if (!instance) {
      throw new Error(`Axios instance '${instanceId}' not found in registry`);
    }
    return instance;
  },
  with(config: { instanceId: string } & CreateAxiosDefaults): AxiosInstance {
    const existing = $axiosRegistry.get(config.instanceId);
    if (existing) {
      return existing;
    }
    const instance = createAxiosInstance(config);
    $axiosRegistry.set(config.instanceId, instance);
    return instance;
  }
}) as ExtendedAxiosInstance;
