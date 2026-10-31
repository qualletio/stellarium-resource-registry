import 'server-only';
import type { ContractVersion, Page, ResourceDetail, ResourceSummary, SearchQuery, Stats } from '@registry/types';

const API_URL = (process.env.API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

/** Synced data changes at most once per sync, so a short revalidation window is plenty. */
const REVALIDATE_SECONDS = 15;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/v1${path}`, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!response.ok) {
    throw new ApiError(`GET ${path} returned ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

export function searchParamsFor(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.in && query.in !== 'all') params.set('in', query.in);
  if (query.paid) params.set('paid', 'true');
  if (query.restricted) params.set('restricted', 'true');
  if (query.inference) params.set('inference', 'true');
  if (query.contract) params.set('contract', 'true');
  if (query.offset) params.set('offset', String(query.offset));
  if (query.limit) params.set('limit', String(query.limit));
  return params;
}

export const getStats = () => get<Stats>('/stats');

export const searchResources = (query: SearchQuery) => get<Page<ResourceSummary>>(`/resources?${searchParamsFor(query)}`);

/** Undefined on a 404. */
async function getOptional<T>(path: string): Promise<T | undefined> {
  try {
    return await get<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

/** Undefined when the registry has never seen the resource. */
export const getResource = (fqn: string) => getOptional<ResourceDetail>(`/resources/${encodeURIComponent(fqn)}`);

/** One version of a contract with its source. Undefined when the registry has no such version. */
export const getContractVersion = (fqn: string, version: string) =>
  getOptional<ContractVersion>(`/resources/${encodeURIComponent(fqn)}/versions/${encodeURIComponent(version)}`);
