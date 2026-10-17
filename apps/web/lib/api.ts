import 'server-only';
import type { NodeSummary, Page, ResourceDetail, ResourceSummary, SearchQuery, Stats, SyncRun } from '@registry/types';

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
  if (query.offset) params.set('offset', String(query.offset));
  if (query.limit) params.set('limit', String(query.limit));
  return params;
}

export const getStats = () => get<Stats>('/stats');

export const searchResources = (query: SearchQuery) => get<Page<ResourceSummary>>(`/resources?${searchParamsFor(query)}`);

/** Undefined when the registry has never seen the resource. */
export async function getResource(fqn: string): Promise<ResourceDetail | undefined> {
  try {
    return await get<ResourceDetail>(`/resources/${encodeURIComponent(fqn)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export const getNodes = async () => (await get<{ items: NodeSummary[] }>('/nodes')).items;

export const getSyncRuns = async (limit = 10) => (await get<{ items: SyncRun[] }>(`/sync/runs?limit=${limit}`)).items;
