export class LinkError extends Error {}
export function parseLink(text) {
  let value = String(text || '').trim();
  if (/^(BV[\da-zA-Z]{10}|av\d+)$/i.test(value)) value = `https://www.bilibili.com/video/${value}`;
  if (/^(www\.|m\.)?bilibili\.com\//i.test(value) || /^b23\.tv\//i.test(value)) value = `https://${value}`;
  let u;
  try { u = new URL(value); } catch { throw new LinkError('请粘贴 B站视频链接、BV号或 av号'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) throw new LinkError('暂不支持该类型链接');
  if (u.hostname === 'b23.tv' && /^\/[\da-zA-Z]+\/?$/.test(u.pathname)) return { short: true, url: `https://b23.tv${u.pathname}` };
  if (!['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(u.hostname)) throw new LinkError('暂不支持该类型链接');
  const match = u.pathname.match(/^\/video\/(BV[\da-zA-Z]{10}|av\d+)\/?$/i);
  if (!match) throw new LinkError('暂不支持该类型链接');
  const rawPage = u.searchParams.get('p') || '1';
  const page = Number(rawPage);
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new LinkError('分P编号必须是大于 0 的整数');
  const id = match[1];
  const bvid = /^bv/i.test(id) ? `BV${id.slice(2)}` : undefined;
  const aid = bvid ? undefined : Number(id.slice(2));
  if (aid !== undefined && (!Number.isSafeInteger(aid) || aid <= 0)) throw new LinkError('av号无效');
  return { bvid, aid, page, url: `https://www.bilibili.com/video/${bvid || `av${aid}`}?p=${page}` };
}
export async function resolveLink(text, fetcher = fetch) {
  let link = parseLink(text);
  if (link.short) {
    const response = await fetcher(link.url, { redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000) });
    link = parseLink(response.url);
    if (link.short) throw new LinkError('短链尚未跳转到视频，请复制完整视频地址');
  }
  return link;
}
