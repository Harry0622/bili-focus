const MESSAGES = { '-352': 'B站风控限制，请稍后重试', '-412': 'B站请求过于频繁，请稍后重试', '-509': 'B站服务繁忙，请稍后重试', '-404': '稿件不存在或已删除' };
export class ApiError extends Error {
  constructor(code, message) { super(MESSAGES[code] || message || '获取视频信息失败'); this.code = code; this.retryable = code !== -404; }
}
export function retryDelay(attempts) { return Math.min(24 * 3600000, 60000 * 2 ** Math.min(11, attempts)); }
export async function fetchVideo(link, fetcher = fetch) {
  const u = new URL('https://api.bilibili.com/x/web-interface/view');
  u.searchParams.set(link.bvid ? 'bvid' : 'aid', String(link.bvid || link.aid));
  let response;
  try { response = await fetcher(u.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000) }); }
  catch { throw new ApiError(0, '网络连接失败，链接已保留，可稍后重试'); }
  if (!response.ok) throw new ApiError(response.status === 412 ? -412 : response.status === 404 ? -404 : response.status, `B站接口暂不可用（${response.status}）`);
  let result;
  try { result = await response.json(); } catch { throw new ApiError(0, '接口返回异常，请稍后重试'); }
  if (!result || typeof result.code !== 'number') throw new ApiError(0, '接口返回异常，请稍后重试');
  if (result.code !== 0) throw new ApiError(Number(result.code), result.message);
  const data = result.data;
  if (!data || !/^BV[\da-zA-Z]{10}$/.test(data.bvid) || typeof data.title !== 'string' || !data.title || !Array.isArray(data.pages) || !data.pages.length || data.pages.some(p => !p || !Number.isSafeInteger(p.cid) || p.cid <= 0 || !Number.isSafeInteger(p.page) || p.page <= 0)) throw new ApiError(0, '视频信息不完整，请稍后重试');
  return data;
}
