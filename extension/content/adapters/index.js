/**
 * 平台适配器注册表。
 * 每个适配器实现：{ id, name, hosts, experimental?, match(url)?, async fill(ctx) -> {ok, message} }
 * ctx = { title, markdown, html, htmlNoBr, util }
 *
 * 维护说明：各平台前端改版会导致选择器失效，fill 内部均为"多级选择器兜底"，
 * 失效时优先在对应选择器数组里补充新选择器即可。
 * 另：fill 失败后 main.js 会自动把内容复制到剪贴板（copyFallback），
 * 用户可手动粘贴，保证平台改版时仍可用。
 */
(function () {
  'use strict';
  const U = self.__MULTIPOST_UTIL__;

  /* ============ 图片直传（平台自有图床）＝ 新增能力；任一环节失败一律回退原文，绝不影响既有填充 ============ */

  /** 适配器日志：写入插件诊断日志 + 控制台（fire-and-forget） */
  function adapterLog(platform, level, message) {
    try { (level === 'error' ? console.error : console.log)('[MultiPost/' + platform + '] ' + message); } catch (_) { /* ignore */ }
    try { chrome.runtime.sendMessage({ type: 'LOG', level: level || 'info', platform: platform, message: message }); } catch (_) { /* ignore */ }
  }

  /** dataURL → Blob（上传用） */
  function mpDataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
    if (!m) throw new Error('dataURL 解析失败');
    const type = m[1] || 'application/octet-stream';
    if (m[2]) {
      const bin = atob(m[3]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: type });
    }
    return new Blob([decodeURIComponent(m[3])], { type: type });
  }

  /** 公众号：上传到微信素材接口 → mmbiz.qpic.cn（发布时不会被剥外链）。
   *  凭证（uin/ticket/token）由后台从页面主世界 wx.commonData 读取（GET_WEIXIN_UPLOAD_CTX） */
  async function uploadImageToWeixin(dataUrl, fileName) {
    const cred = await chrome.runtime.sendMessage({ type: 'GET_WEIXIN_UPLOAD_CTX' });
    if (!cred || !cred.ok) throw new Error((cred && cred.error) || '无法获取公众号上传凭证');
    const fd = new FormData();
    fd.append('file', mpDataUrlToBlob(dataUrl), fileName || 'image.png');
    const ts = Math.floor(Date.now() / 1000);
    const url = 'https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1'
      + '&ticket_id=' + encodeURIComponent(cred.uin || '')
      + '&ticket=' + encodeURIComponent(cred.ticket)
      + '&svr_time=' + ts
      + '&token=' + encodeURIComponent(cred.token || '')
      + '&lang=zh_CN&seq=' + Date.now();
    const resp = await fetch(url, { method: 'POST', body: fd, credentials: 'include' });
    const txt = await resp.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) { /* ignore */ }
    const cdn = j && (j.cdn_url || (j.content && j.content.cdn_url));
    const ret = j && j.ret;
    if (resp.ok && cdn && (ret === undefined || ret === 0 || ret === '0')) return { url: cdn };
    throw new Error('公众号接口返回异常 HTTP ' + resp.status + ' ' + txt.slice(0, 120));
  }

  /* ---- 纯 JS MD5（crypto.subtle 不支持 MD5，知乎 image_hash 需要）----
     已用 Node crypto 参照验证：''/abc/43/56/64/119/200 字节等向量全部一致 */
  function mpAdd32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function mpCmn(q, a, b, x, s, t) { a = mpAdd32(mpAdd32(a, q), mpAdd32(x, t)); return mpAdd32((a << s) | (a >>> (32 - s)), b); }
  function mpFf(a, b, c, d, x, s, t) { return mpCmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function mpGg(a, b, c, d, x, s, t) { return mpCmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function mpHh(a, b, c, d, x, s, t) { return mpCmn(b ^ c ^ d, a, b, x, s, t); }
  function mpIi(a, b, c, d, x, s, t) { return mpCmn(c ^ (b | (~d)), a, b, x, s, t); }
  function mpMd5Cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = mpFf(a, b, c, d, k[0], 7, -680876936); d = mpFf(d, a, b, c, k[1], 12, -389564586); c = mpFf(c, d, a, b, k[2], 17, 606105819); b = mpFf(b, c, d, a, k[3], 22, -1044525330);
    a = mpFf(a, b, c, d, k[4], 7, -176418897); d = mpFf(d, a, b, c, k[5], 12, 1200080426); c = mpFf(c, d, a, b, k[6], 17, -1473231341); b = mpFf(b, c, d, a, k[7], 22, -45705983);
    a = mpFf(a, b, c, d, k[8], 7, 1770035416); d = mpFf(d, a, b, c, k[9], 12, -1958414417); c = mpFf(c, d, a, b, k[10], 17, -42063); b = mpFf(b, c, d, a, k[11], 22, -1990404162);
    a = mpFf(a, b, c, d, k[12], 7, 1804603682); d = mpFf(d, a, b, c, k[13], 12, -40341101); c = mpFf(c, d, a, b, k[14], 17, -1502002290); b = mpFf(b, c, d, a, k[15], 22, 1236535329);
    a = mpGg(a, b, c, d, k[1], 5, -165796510); d = mpGg(d, a, b, c, k[6], 9, -1069501632); c = mpGg(c, d, a, b, k[11], 14, 643717713); b = mpGg(b, c, d, a, k[0], 20, -373897302);
    a = mpGg(a, b, c, d, k[5], 5, -701558691); d = mpGg(d, a, b, c, k[10], 9, 38016083); c = mpGg(c, d, a, b, k[15], 14, -660478335); b = mpGg(b, c, d, a, k[4], 20, -405537848);
    a = mpGg(a, b, c, d, k[9], 5, 568446438); d = mpGg(d, a, b, c, k[14], 9, -1019803690); c = mpGg(c, d, a, b, k[3], 14, -187363961); b = mpGg(b, c, d, a, k[8], 20, 1163531501);
    a = mpGg(a, b, c, d, k[13], 5, -1444681467); d = mpGg(d, a, b, c, k[2], 9, -51403784); c = mpGg(c, d, a, b, k[7], 14, 1735328473); b = mpGg(b, c, d, a, k[12], 20, -1926607734);
    a = mpHh(a, b, c, d, k[5], 4, -378558); d = mpHh(d, a, b, c, k[8], 11, -2022574463); c = mpHh(c, d, a, b, k[11], 16, 1839030562); b = mpHh(b, c, d, a, k[14], 23, -35309556);
    a = mpHh(a, b, c, d, k[1], 4, -1530992060); d = mpHh(d, a, b, c, k[4], 11, 1272893353); c = mpHh(c, d, a, b, k[7], 16, -155497632); b = mpHh(b, c, d, a, k[10], 23, -1094730640);
    a = mpHh(a, b, c, d, k[13], 4, 681279174); d = mpHh(d, a, b, c, k[0], 11, -358537222); c = mpHh(c, d, a, b, k[3], 16, -722521979); b = mpHh(b, c, d, a, k[6], 23, 76029189);
    a = mpHh(a, b, c, d, k[9], 4, -640364487); d = mpHh(d, a, b, c, k[12], 11, -421815835); c = mpHh(c, d, a, b, k[15], 16, 530742520); b = mpHh(b, c, d, a, k[2], 23, -995338651);
    a = mpIi(a, b, c, d, k[0], 6, -198630844); d = mpIi(d, a, b, c, k[7], 10, 1126891415); c = mpIi(c, d, a, b, k[14], 15, -1416354905); b = mpIi(b, c, d, a, k[5], 21, -57434055);
    a = mpIi(a, b, c, d, k[12], 6, 1700485571); d = mpIi(d, a, b, c, k[3], 10, -1894986606); c = mpIi(c, d, a, b, k[10], 15, -1051523); b = mpIi(b, c, d, a, k[1], 21, -2054922799);
    a = mpIi(a, b, c, d, k[8], 6, 1873313359); d = mpIi(d, a, b, c, k[15], 10, -30611744); c = mpIi(c, d, a, b, k[6], 15, -1560198380); b = mpIi(b, c, d, a, k[13], 21, 1309151649);
    a = mpIi(a, b, c, d, k[4], 6, -145523070); d = mpIi(d, a, b, c, k[11], 10, -1120210379); c = mpIi(c, d, a, b, k[2], 15, 718787259); b = mpIi(b, c, d, a, k[9], 21, -343485551);
    x[0] = mpAdd32(a, x[0]); x[1] = mpAdd32(b, x[1]); x[2] = mpAdd32(c, x[2]); x[3] = mpAdd32(d, x[3]);
  }
  /** Uint8Array → MD5 十六进制（小端输出，与标准 md5sum 一致） */
  function mpMd5Hex(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    const n = bin.length;
    const st = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) {
      const blk = [];
      const seg = bin.substring(i - 64, i);
      for (let q = 0; q < 64; q += 4) blk[q >> 2] = seg.charCodeAt(q) + (seg.charCodeAt(q + 1) << 8) + (seg.charCodeAt(q + 2) << 16) + (seg.charCodeAt(q + 3) << 24);
      mpMd5Cycle(st, blk);
    }
    const rest = bin.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < rest.length; i++) tail[i >> 2] |= rest.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { mpMd5Cycle(st, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
    tail[14] = n * 8;
    mpMd5Cycle(st, tail);
    const HX = '0123456789abcdef';
    let out = '';
    for (let w = 0; w < 4; w++) {
      for (let j = 0; j < 4; j++) out += HX.charAt((st[w] >> (j * 8 + 4)) & 15) + HX.charAt((st[w] >> (j * 8)) & 15);
    }
    return out;
  }

  /** HMAC-SHA1 → base64（OSS V1 签名用；内容脚本运行在 https 安全上下文，crypto.subtle 可用） */
  async function mpHmacSha1Base64(secret, message) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const u8 = new Uint8Array(mac);
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  /** HMAC-SHA256 → base64（CSDN bizapi 网关签名用；与 SHA-1 版仅 hash 参数不同） */
  async function mpHmacSha256Base64(secret, message) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const u8 = new Uint8Array(mac);
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  /** UUID v4（CSDN 网关 X-Ca-Nonce 用） */
  function mpUuidV4() {
    const hx = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += '89ab'.charAt(Math.floor(Math.random() * 4));
      else s += hx.charAt(Math.floor(Math.random() * 16));
    }
    return s;
  }

  /** 知乎：注册 → OSS 签名直传 → 状态回报 → 取 src（端点已于 2026-10-24 实测全流程 200）。
   *  与编辑器原生粘贴一致：返回第④步带签名的草稿图 URL，发布时知乎按内容 hash 重写为永久地址 */
  async function uploadImageToZhihu(dataUrl) {
    const blob = mpDataUrlToBlob(dataUrl);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = mpMd5Hex(bytes);
    const ct = blob.type || 'image/png';
    // ① 注册上传（服务端按 hash 去重，同图返回相同 image_id）
    const r1 = await fetch('https://api.zhihu.com/images', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_hash: hash, source: 'article' })
    });
    let j1 = null;
    try { j1 = await r1.json(); } catch (_) { /* ignore */ }
    const tk = j1 && j1.upload_token;
    const fk = (j1 && j1.upload_file) || {};
    if (!r1.ok || !tk) throw new Error('知乎图片注册失败 HTTP ' + r1.status + ' ' + JSON.stringify(j1).slice(0, 120));
    // ② OSS V1 签名直传。两个实测要点：
    //    a) canonicalized resource 必须带 bucket 名：/zhihu-pics/<object_key>（服务端 HostId 为 zhihu-pics.oss-cn-beijing）
    //    b) x-oss-date 同时出现在日期位与 x-oss-* 头区 —— 与 ali-oss@6.8.0 行为一致
    const date = new Date().toUTCString();
    const s2s = ['PUT', '', ct, date,
      'x-oss-date:' + date,
      'x-oss-security-token:' + tk.access_token,
      'x-oss-user-agent:' + navigator.userAgent,
      '/zhihu-pics/' + fk.object_key].join('\n');
    const sig = await mpHmacSha1Base64(tk.access_key, s2s);
    const r2 = await fetch('https://zhihu-pics-upload.zhimg.com:443/' + fk.object_key, {
      method: 'PUT', body: blob,
      headers: {
        'x-oss-date': date,
        'x-oss-user-agent': navigator.userAgent,
        'x-oss-security-token': tk.access_token,
        'Content-Type': ct,
        'Authorization': 'OSS ' + tk.access_id + ':' + sig
      }
    });
    if (!r2.ok) throw new Error('知乎 OSS 直传失败 HTTP ' + r2.status + ' ' + (await r2.text()).slice(0, 160));
    // ③ 状态回报（尽力而为，失败不影响取 src）
    try {
      await fetch('https://api.zhihu.com/images/' + fk.image_id + '/uploading_status', {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upload_result: 'success' })
      });
    } catch (_) { /* ignore */ }
    // ④ 取图片地址（含 src / original_src 等字段）
    const r4 = await fetch('https://api.zhihu.com/images/' + fk.image_id, { credentials: 'include' });
    let j4 = null;
    try { j4 = await r4.json(); } catch (_) { /* ignore */ }
    if (r4.ok && j4 && j4.src) return { url: j4.src };
    throw new Error('知乎未返回图片地址 HTTP ' + r4.status + ' ' + JSON.stringify(j4).slice(0, 120));
  }

  /** B站：york 编辑器同款接口 upload_bfs → i0.hdslb.com/bfs/new_dyn/（端点已于 2026-10-24 实测，
   *  旧 article-text/creative 编辑器与其 bfs/article 图床已停用）。无需 WBI 签名，最小参数即可 */
  function mpBiliCsrf() {
    const parts = document.cookie.split('; ');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('bili_jct=') === 0) return parts[i].substring(9);
    }
    return '';
  }
  async function uploadImageToBilibili(dataUrl, fileName) {
    const blob = mpDataUrlToBlob(dataUrl);
    const ext = /jpe?g/.test(blob.type) ? 'jpg' : (/webp/.test(blob.type) ? 'webp' : 'png');
    const base = String(fileName || 'image').replace(/\.[^.]+$/, '') || 'image';
    const fd = new FormData();
    fd.append('file_up', blob, base + '.' + ext);
    fd.append('biz', 'new_dyn');
    fd.append('category', 'daily');
    fd.append('csrf', mpBiliCsrf());
    const resp = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', { method: 'POST', body: fd, credentials: 'include' });
    const txt = await resp.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) { /* ignore */ }
    const u = j && j.data && j.data.image_url;
    if (resp.ok && j && j.code === 0 && u) return { url: u.replace('http://', 'https://') };
    throw new Error('B站上传接口返回异常 HTTP ' + resp.status + ' ' + txt.slice(0, 120));
  }

  /** CSDN：bizapi 网关取签名 → 华为 OBS 表单直传 → i-blog.csdnimg.cn 永久链接
   *  （端点与密钥已于 2026-10-24 实测全流程 200。签名算法自前端包 csdn-http.js 还原：
   *  阿里云 API 网关风格 HMAC-SHA256；stringToSign 五个固定位 + 三行 x-ca-* 头 + 请求路径，
   *  其中 Content-MD5 位与 date 位恒为空串。appKey/appSecret 硬编码于前端包 csdn-upload.js） */
  const MP_CSDN_APP_KEY = '260196572';
  const MP_CSDN_APP_SECRET = 't5PaqxVQpWoHgLGt7XPIvd5ipJcwJTU7';
  const MP_CSDN_SIGN_PATH = '/resource-api/v1/image/direct/upload/signature';
  async function uploadImageToCsdn(dataUrl) {
    const blob = mpDataUrlToBlob(dataUrl);
    const suffix = /jpe?g/.test(blob.type) ? 'jpeg' : (/webp/.test(blob.type) ? 'webp' : (/gif/.test(blob.type) ? 'gif' : 'png'));
    // ① bizapi 网关签名接口（Kong 网关实现，签错返回 401 HMAC signature does not match）
    const ts = String(Date.now());
    const nonce = mpUuidV4();
    const s2s = ['POST', 'application/json, text/plain, */*', '', 'application/json;charset=UTF-8', '',
      'x-ca-key:' + MP_CSDN_APP_KEY, 'x-ca-nonce:' + nonce, 'x-ca-timestamp:' + ts, MP_CSDN_SIGN_PATH].join('\n');
    const sig = await mpHmacSha256Base64(MP_CSDN_APP_SECRET, s2s);
    const r1 = await fetch('https://bizapi.csdn.net' + MP_CSDN_SIGN_PATH, {
      method: 'POST', credentials: 'include',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'x-Ca-Timestamp': ts,
        'X-Ca-Key': MP_CSDN_APP_KEY,
        'X-Ca-Nonce': nonce,
        'X-Ca-Signature': sig,
        'X-Ca-Signature-Headers': 'x-ca-key,x-ca-nonce,x-ca-timestamp'
      },
      body: JSON.stringify({ imageTemplate: '', appName: 'direct_blog', imageSuffix: suffix })
    });
    const t1 = await r1.text();
    let j1 = null;
    try { j1 = JSON.parse(t1); } catch (_) { /* ignore */ }
    const d = j1 && j1.data;
    if (!r1.ok || !d || !d.filePath) throw new Error('CSDN 签名接口异常 HTTP ' + r1.status + ' ' + t1.slice(0, 120));
    // ② OBS 表单直传：key/policy/signature/回调字段 + x:* 自定义参数，file 必须最后；
    //    provider=obs 用 callbackUrl/AccessKeyId（阿里云 OSS 则为 callback/OSSAccessKeyId）。
    //    响应即 OBS 回调 JSON，data.imageUrl 为 i-blog.csdnimg.cn 永久地址
    const fd = new FormData();
    fd.set('key', d.filePath);
    fd.set('policy', d.policy);
    fd.set('signature', d.signature);
    fd.set('callbackBody', d.callbackBody || '');
    fd.set('callbackBodyType', d.callbackBodyType || '');
    if (d.provider === 'obs') { fd.set('callbackUrl', d.callbackUrl || ''); fd.set('AccessKeyId', d.accessId); }
    else { fd.set('callback', d.callbackUrl || ''); fd.set('OSSAccessKeyId', d.accessId); }
    const cp = d.customParam || {};
    for (const k in cp) fd.set('x:' + k, cp[k]);
    fd.set('file', blob, 'image.' + suffix);
    const r2 = await fetch(d.host, { method: 'POST', body: fd });
    const t2 = await r2.text();
    let j2 = null;
    try { j2 = JSON.parse(t2); } catch (_) { /* ignore */ }
    const u = j2 && j2.data && j2.data.imageUrl;
    if (r2.ok && j2 && j2.code === 200 && u) return { url: u };
    throw new Error('CSDN OBS 直传失败 HTTP ' + r2.status + ' ' + t2.slice(0, 120));
  }

  /* ---------------- 知乎专栏 ---------------- */
  const zhihu = {
    id: 'zhihu',
    name: '知乎专栏',
    hosts: ['zhuanlan.zhihu.com'],
    async fill(ctx) {
      // 登录态检查：未登录会被重定向到登录页
      if (/signin|signup/.test(location.pathname)) {
        return { ok: false, message: '知乎未登录，请先在浏览器登录后再同步' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          '.WriteIndex-titleInput textarea',
          '.TitleInput textarea',
          '#Editable-title textarea'
        ]
      });
      // 知乎编辑器是 DraftJS：会把 <br> 解析成空段落（表现为多出好多空行）。
      // 用无 <br> 的块级 HTML（每行独立 <p>），排版紧凑。
      // ① LaTeX 公式 → codecogs PNG 公式图（<img> 标签）。
      //    0.4.11 实测：知乎 DraftJS 粘贴解析只认白名单标签（p/a/img/ul/…），
      //    MathJax 产物是裸 <svg>，不在白名单内会被连内容整段丢弃（公式全部消失）；
      //    <img> 在白名单内，且知乎会对它做服务器转存（codecogs PNG 实测可转存）。
      //    latexMdToImg 为同步函数、不依赖 MathJax 加载，无公式时返回原文。
      // ② 嵌套列表转 DraftJS 兄弟结构（子 ul 提到 li 外），否则嵌套收束处被插入空行
      // ③ cleanupEmptyBlocks：粘贴后再清一遍 DraftJS 自动插入的空块（列表→标题边界）
      // ⓪ 图片直传：先把文章外链图重传到知乎图床（pic*.zhimg.com）。
      //    平台服务器转存外链失败（如 iili.io 防盗链）时由此兜底；失败自动保留原链接
      let mdZ0 = ctx.markdown;
      try {
        if (U.rehostMdImages && /!\[[^\]]*\]\((https?:)/.test(mdZ0)) {
          mdZ0 = await U.rehostMdImages(mdZ0, uploadImageToZhihu, (l, m) => adapterLog('zhihu', l, m));
        }
      } catch (_) { mdZ0 = ctx.markdown; }
      const mdWithMath = U.latexMdToImg(mdZ0);
      let htmlZ = U.mdToHtmlNoBreaks(mdWithMath);
      const theme = ctx.themeId && (self.MULTIPOST_THEMES || []).find((t) => t.id === ctx.themeId);
      if (theme && self.MULTIPOST_APPLY_THEME) htmlZ = self.MULTIPOST_APPLY_THEME(htmlZ, theme);
      const rich = await U.fillRichText({
        html: U.hoistNestedLists(htmlZ),
        text: ctx.markdown,
        selectors: [
          '.public-DraftEditor-content[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          '.Editable .EditableView [contenteditable="true"]',
          '#editable-content [contenteditable="true"]'
        ],
        cleanupEmptyBlocks: true
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 掘金 ---------------- */
  const juejin = {
    id: 'juejin',
    name: '掘金',
    hosts: ['juejin.cn'],
    async fill(ctx) {
      // 未登录会被重定向到登录页（manifest 已放宽到整站注入，便于识别）
      if (/\/login|\/signin/.test(location.pathname)) {
        return { ok: false, message: '掘金未登录，请先在浏览器登录 juejin.cn 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          '.title-input textarea',
          '.header .title-input input'
        ]
      });
      // 掘金编辑器为 bytemd（底层 CodeMirror 6）：
      // fillMarkdown 会优先走「主世界 CM6 实例直写」，这里选择器只作兜底。
      // 注意 .bytemd textarea 是 bytemd 的隐藏同步框，直接赋值不会生效，仅作最后兜底。
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        timeout: 30000,
        selectors: [
          '.cm-content[contenteditable="true"]',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea.markdown-editor-input',
          '.markdown-body textarea',
          '.bytemd textarea',
          'textarea[placeholder*="Markdown"]'
        ]
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- CSDN ---------------- */
  const csdn = {
    id: 'csdn',
    name: 'CSDN',
    hosts: ['editor.csdn.net'],
    async fill(ctx) {
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input.text-editor-title',
          'input[placeholder*="标题"]',
          '.article-bar input.title',
          '#txtTitle'
        ]
      });
      // CSDN 新版 Markdown 编辑器底层为 CodeMirror 6，优先走 CM6 实例写入。
      // ⓪ 图片直传：先把文章外链图重传到 CSDN 自有图床（i-blog.csdnimg.cn）。
      //    CSDN 服务器转存境外防盗链外链（如 iili.io）必失败 → 编辑器裂图，由此兜底；
      //    逐张独立容错，失败自动保留原链接。CSDN 原生渲染公式，不做公式转换
      let mdC0 = ctx.markdown;
      const csdnImgMap = {};
      try {
        if (U.rehostMdImages && /!\[[^\]]*\]\((https?:)/.test(mdC0)) {
          mdC0 = await U.rehostMdImages(mdC0, uploadImageToCsdn, (l, m) => adapterLog('csdn', l, m), csdnImgMap);
        }
      } catch (_) { mdC0 = ctx.markdown; }
      const body = await U.fillMarkdown({
        markdown: mdC0,
        timeout: 40000,
        selectors: [
          'textarea#editor',
          'pre#editor',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          '.cm-content[contenteditable="true"]',
          '.editor__inner textarea',
          'textarea[placeholder*="markdown" i]'
        ]
      });
      if (body.ok) {
        return { ok: title.ok, message: title.ok ? '' : title.message };
      }
      // Markdown 模式失败 → 可能用户默认是「富文本」编辑器，兜底走富文本填充。
      // 富文本里的 <img> 与 Markdown 同源，用同一份重传映射替换 src（无映射则原样保留）
      const rich = await U.fillRichText({
        html: U.replaceHtmlImgUrls(ctx.html, csdnImgMap),
        text: mdC0,
        timeout: 8000,
        selectors: [
          '[contenteditable="true"].editor__inner',
          'div[contenteditable="true"][class*="editor"]',
          'div[contenteditable="true"][class*="content"]'
        ]
      });
      const bodyOk = body.ok || rich.ok;
      const bodyMsg = [body.ok ? '' : body.message, rich.ok ? '' : rich.message].filter(Boolean).join('；');
      return {
        ok: title.ok && bodyOk,
        message: [title.ok ? '' : title.message, bodyOk ? '' : bodyMsg].filter(Boolean).join('；')
      };
    }
  };

  /* ---------------- 微信公众号 ---------------- */
  const weixin = {
    id: 'weixin',
    name: '微信公众号',
    hosts: ['mp.weixin.qq.com'],
    async fill(ctx) {
      // 未登录会落在扫码登录页
      if (document.querySelector('.login__type__container__scan, .qrcode_area, #scan_qrcode') ||
          /\/cgi-bin\/loginpage/.test(location.href)) {
        return { ok: false, message: '公众号未登录，请先扫码登录 mp.weixin.qq.com 后重试' };
      }

      // 公众号编辑页必须携带 token 参数；插件打开的无 token 链接会被重定向回首页，
      // 表现为"标题输入框/富文本编辑器都找不到"。这里从页面提取 token（先查 URL，
      // 再查 HTML，带重试等待），然后自动跳转到带 token 的编辑页。返回 silent：
      // 本次不回报结果，跳转后新页面的 content 脚本会重新领取任务并继续填充。
      if (!/[?&]action=edit/.test(location.search)) {
        const token = await U.waitFor(findWxToken, { timeout: 12000, interval: 600 });
        if (token) {
          const url = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=' + token;
          location.href = url;
          return { ok: false, silent: true, message: '已获取公众号 token，正在跳转编辑页…' };
        }
        return { ok: false, message: '未进入公众号编辑页，且页面未找到 token；请先在浏览器登录 mp.weixin.qq.com（能看到左侧菜单的首页），再重新同步' };
      }

      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea#title',
          'textarea[placeholder*="请在这里输入标题"]',
          '#title',
          'input[name="title"]',
          '.title-input textarea',
          'textarea[placeholder*="标题"]'
        ],
        timeout: 25000
      });
      // 标题填完立即失焦：防止后续正文填充时焦点残留把内容写进标题框
      try { document.activeElement && document.activeElement.blur(); } catch (_) { /* ignore */ }
      // ⓪ 图片直传：先把文章外链图重传为公众号素材（mmbiz.qpic.cn）。
      //    公众号发布时会剥掉非微信域外链图，直传后图片可正常发布显示；失败自动保留原链接
      let mdW0 = ctx.markdown;
      try {
        if (U.rehostMdImages && /!\[[^\]]*\]\((https?:)/.test(mdW0)) {
          mdW0 = await U.rehostMdImages(mdW0, uploadImageToWeixin, (l, m) => adapterLog('weixin', l, m));
        }
      } catch (_) { mdW0 = ctx.markdown; }
      // 公式渲染：公众号不解析 LaTeX（$$...$$ 只显示源码）。转 MathJax 内联
      // SVG（mdnice 同款，随粘贴内容自带路径，无需图片转存）；MathJax 不可用
      // 自动回退 codecogs PNG 图。再按原流程生成主题 HTML（与 ctx.html 同管线）
      let htmlW = ctx.html;
      if (mdW0 !== ctx.markdown) {
        // 有图片被重传：基于新 markdown 重算富文本（公式转换 + 主题全部补齐）
        try {
          let mdW = mdW0;
          if (/\$[\s\S]/.test(mdW) && U.latexMdToRich && U.mdToHtml) {
            const c = await U.latexMdToRich(mdW);
            if (c && c !== mdW) mdW = c;
          }
          htmlW = U.mdToHtml(mdW);
          const theme = ctx.themeId && (self.MULTIPOST_THEMES || []).find((t) => t.id === ctx.themeId);
          if (theme && self.MULTIPOST_APPLY_THEME) htmlW = self.MULTIPOST_APPLY_THEME(htmlW, theme);
        } catch (_) { htmlW = ctx.html; }
      } else if (/\$[\s\S]/.test(ctx.markdown) && U.latexMdToRich && U.mdToHtml) {
        try {
          const mdW = await U.latexMdToRich(ctx.markdown);
          if (mdW !== ctx.markdown) {
            htmlW = U.mdToHtml(mdW);
            const theme = ctx.themeId && (self.MULTIPOST_THEMES || []).find((t) => t.id === ctx.themeId);
            if (theme && self.MULTIPOST_APPLY_THEME) htmlW = self.MULTIPOST_APPLY_THEME(htmlW, theme);
          }
        } catch (_) { htmlW = ctx.html; /* 公式转换失败退回原文 */ }
      }
      // 正文：新版编辑器 = 顶层文档里的 ProseMirror（#ueditor_0 是 mock-iframe，
      // 只是 CSS 类不是真 iframe，实测 DOM 来自页面存档）。选择器全部限定在
      // 正文编辑器上——绝不放宽到任意 contenteditable：标题也是 .ProseMirror
      //（data-placeholder="请在这里输入标题"），0.4.4 曾把整篇正文粘进标题框；
      // looksLikeTitleField 护栏现已覆盖 data-placeholder，此处再按正文容器限定
      const rich = await U.fillRichText({
        html: htmlW,
        text: ctx.markdown,
        timeout: 45000,
        directHtml: true,
        selectors: [
          // 真实结构（页面存档确认）：#ueditor_0.mock-iframe > .mock-iframe-body > .rich_media_content > .ProseMirror
          '.rich_media_content .ProseMirror[contenteditable="true"]',
          '#ueditor_0 .ProseMirror[contenteditable="true"]',
          '.mock-iframe-body .ProseMirror[contenteditable="true"]',
          '.editor-v-root .ProseMirror[contenteditable="true"]',
          '.rich_media_content[contenteditable="true"]',
          '.edui-body-container[contenteditable="true"]',
          'div[contenteditable][data-placeholder*="正文"]',
          'div[contenteditable="true"][aria-label*="正文"]',
          // 旧版 UEditor 式 iframe：可编辑的 iframe body（firstExisting 会进 iframe 查找）
          'body[contenteditable="true"]'
        ]
      });
      // 标题污染恢复：历史版本曾把正文粘进标题框，若标题内容远超标题长度则还原
      //（标题真实结构：.title-editor__input > .ProseMirror[data-placeholder=请在这里输入标题]）
      try {
        const t = document.querySelector('textarea#title, #title[contenteditable], .title-editor__input .ProseMirror, div[contenteditable="true"][class*="title" i]');
        const cur = t ? (t.value !== undefined ? t.value : t.textContent) : '';
        if (t && cur && cur.length > ctx.title.length + 5) {
          if (t.value !== undefined) t.value = ctx.title;
          else t.textContent = ctx.title;
          t.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (_) { /* ignore */ }
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /** 从公众号页面提取 token（content script 与页面 JS 隔离，只能从 URL/DOM 正则提取） */
  function findWxToken() {
    try {
      // 首页重定向后 token 通常直接出现在地址栏
      let m = location.href.match(/[?&]token=(\d+)/);
      if (m) return m[1];
      m = document.documentElement.innerHTML.match(/[?&]token=(\d+)/);
      if (m) return m[1];
    } catch (_) { /* ignore */ }
    return null;
  }

  /* ---------------- 今日头条（头条号） ---------------- */
  const toutiao = {
    id: 'toutiao',
    name: '今日头条',
    hosts: ['mp.toutiao.com'],
    async fill(ctx) {
      if (/login/.test(location.href)) {
        return { ok: false, message: '头条号未登录，请先登录 mp.toutiao.com 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          '.article-title textarea',
          '.title-input textarea'
        ]
      });
      // 公式预处理：头条编辑器不解析 LaTeX（实测 $$...$$ 原样显示为源码文本），
      // 先把公式转成 codecogs PNG 公式图（<img> 标签，富文本编辑器普遍接受）；
      // 无公式时 latexMdToImg 返回原文，仍走 ctx.html 保持旧行为逐字节不变
      const mdT = U.latexMdToImg(ctx.markdown);
      const rich = await U.fillRichText({
        html: mdT !== ctx.markdown ? U.mdToHtmlNoBreaks(mdT) : ctx.html,
        text: ctx.markdown,
        directHtml: true,
        selectors: [
          '.ProseMirror[contenteditable="true"]',
          '.editor-content[contenteditable="true"]',
          '[class*="editor"] [contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 简书（实验性） ---------------- */
  const jianshu = {
    id: 'jianshu',
    name: '简书',
    hosts: ['www.jianshu.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录 / 未进入创作中心：跳到 writer 入口（返回 silent，跳转后重新领任务）
      if (!/\/writer/.test(location.pathname)) {
        if (/\/(sign_up|signin)/.test(location.pathname)) {
          return { ok: false, message: '简书未登录，请先登录 www.jianshu.com 后重试' };
        }
        location.href = 'https://www.jianshu.com/writer';
        return { ok: false, silent: true, message: '正在进入简书创作中心…' };
      }

      // 简书必须写到「新建笔记」里：直接打开 writer 会命中上次的旧草稿（默认标题是
      // 日期，如 2026-10-23）。之前点击「新建文章」后只 sleep(1500)，SPA 路由还没切完
      // 就开始找标题，导致标题填充失败或写进旧草稿；现在改为等待路由 hash 真正切到
      // /notes/:id 再继续。
      const onNotePage = () => /\/notes\/\d+/.test(location.hash);
      // 已在笔记页但标题是纯日期 → 命中的是旧草稿，同样需要点「新建文章」换到新笔记
      const looksLikeOldDraft = () => {
        const el = jianshuTitleFinder();
        if (!el) return false;
        const v = String(el.value != null ? el.value : el.textContent || '').trim();
        return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v);
      };
      if (!onNotePage() || looksLikeOldDraft()) {
        const newBtn = await U.waitFor(() =>
          [...document.querySelectorAll('a, button, [role="button"], li, span')]
            .find((e) => /新建文章|写文章/.test((e.textContent || '').trim()) && U.isVisible(e))
        , { timeout: 8000 });
        if (newBtn) {
          newBtn.click();
          await U.waitFor(onNotePage, { timeout: 10000, interval: 400 });
          await U.sleep(1200); // 新笔记编辑器挂载
        }
      }

      // 标题：简书 writer 的选择器随版本变化（_24i7q 等哈希类不可靠），
      // 用特征查找：编辑器区域内、靠页面顶部、宽度足够的单行输入框
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input.note-title',
          'input._24i7q',
          'header input[type="text"]'
        ],
        timeout: 8000,
        finder: jianshuTitleFinder
      });
      // 公式预处理：简书编辑器（Markdown/富文本两种模式）都不渲染 LaTeX，
      // 先把公式转成 codecogs PNG 公式图；无公式时返回原文，行为不变
      const mdJ = U.latexMdToImg(ctx.markdown);
      // 先按 Markdown 编辑器填；失败再按富文本编辑器兜底
      const body = await U.fillMarkdown({
        markdown: mdJ,
        selectors: [
          'textarea#arthur-editor',
          'textarea.note-edit',
          'textarea[placeholder*="正文"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea'
        ],
        timeout: 15000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: mdJ !== ctx.markdown ? U.mdToHtmlNoBreaks(mdJ) : (ctx.htmlNoBr || ctx.html),
          text: ctx.markdown,
          timeout: 8000,
          directHtml: true,
          selectors: [
            'div[contenteditable="true"][class*="editor"]',
            'div[contenteditable="true"][class*="content"]',
            '.arthur-editor div[contenteditable="true"]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /**
   * 简书标题自定义查找：
   * 1) 语义特征优先：placeholder/class 带标题特征的可编辑元素
   *    （简书改版后标题可能是 contenteditable，而非 input/textarea）；
   * 2) 几何特征兜底：可见单行输入框，位于编辑区（右侧 2/3、页面顶部 50%），
   *    宽度 > 200px 且高度 < 100px（排除侧栏搜索框与正文编辑器）。
   */
  function jianshuTitleFinder() {
    const semantic = document.querySelectorAll([
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input.note-title',
      'input[class*="title" i]',
      'textarea[class*="title" i]',
      'div[contenteditable="true"][class*="title" i]',
      '[class*="Title"] input'
    ].join(','));
    for (const el of semantic) {
      try {
        if (!U.isVisible(el)) continue;
        const ph = el.getAttribute('placeholder') || '';
        if (ph.includes('标题')) return el;
        const r = el.getBoundingClientRect();
        if (r.width >= 200 && r.left >= window.innerWidth * 0.3 && r.top <= window.innerHeight * 0.5) return el;
      } catch (_) { /* ignore */ }
    }
    const els = document.querySelectorAll('input[type="text"], input:not([type]), textarea, div[contenteditable="true"]');
    for (const el of els) {
      try {
        if (!U.isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height > 100) continue;
        if (r.left < window.innerWidth * 0.3) continue; // 排除左侧栏
        if (r.top > window.innerHeight * 0.5) continue; // 标题在编辑区顶部（放宽到 50%）
        // contenteditable 候选若位于正文编辑器容器内则跳过，避免误选正文
        if (el.tagName === 'DIV' && el.isContentEditable &&
            el.closest('[class*="editor" i], .arthur-editor')) continue;
        return el;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  /* ---------------- 博客园（实验性） ---------------- */
  const cnblogs = {
    id: 'cnblogs',
    name: '博客园',
    hosts: ['i.cnblogs.com'],
    experimental: true,
    async fill(ctx) {
      // 登录态 / 开通状态检查：博客园要求账号先开通博客功能才能进入后台
      const pageText = (document.body && document.body.innerText) || '';
      if (/登录|signin/i.test(location.pathname) || /请登录|用户登录/.test(pageText.slice(0, 500))) {
        return { ok: false, message: '博客园未登录，请先登录 i.cnblogs.com 后重试' };
      }
      if (/未开通博客/.test(pageText)) {
        return {
          ok: false,
          message: '博客园账号未开通博客功能（与登录与否无关）：请到 i.cnblogs.com 按提示「申请开通博客」，人工审核通过后（通常 1-3 天）再同步'
        };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input#post-title',
          'input[name="Title"]',
          'input[id*="Title"]',
          'input[placeholder*="标题"]'
        ]
      });
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea#md-editor',
          'textarea#Editor_Edit_EditorBody',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[name*="EditorBody"]',
          'textarea[id*="editor" i]'
        ]
      }).then(async (res) => {
        if (res.ok) return res;
        // TinyMCE（富文本模式）兜底
        const iframe = document.querySelector('iframe#iframe_Edit_EditorBody, iframe[id*="EditorBody"], iframe.mce-edit-area');
        if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
          iframe.contentDocument.body.innerHTML = ctx.html;
          return { ok: true, message: '已通过 TinyMCE iframe 填充' };
        }
        return res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- B站专栏（实验性，新版 york 编辑器） ---------------- */
  const bilibili = {
    id: 'bilibili',
    name: 'B站专栏',
    hosts: ['member.bilibili.com'],
    experimental: true,
    async fill(ctx) {
      if (/passport\.bilibili\.com|\/login/.test(location.href)) {
        return { ok: false, message: 'B站未登录，请先登录 bilibili.com 后重试' };
      }
      // 旧版 read/editor/#/web 已下线：页面提示"旧版编辑器已停止使用"时自动跳新版 york 编辑器
      if (/\/read\/editor/.test(location.pathname)) {
        const pageText = (document.body && document.body.innerText) || '';
        if (/旧版编辑器已停止使用|旧版编辑器已下线/.test(pageText)) {
          location.href = 'https://member.bilibili.com/york/read-editor';
          return { ok: false, silent: true, message: '正在跳转 B站新版专栏编辑器…' };
        }
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder*="标题"]',
          'textarea[placeholder*="30字"]',
          'input[placeholder*="标题"]',
          '.b-read-editor__title textarea',
          'div[contenteditable="true"][class*="title" i]'
        ],
        timeout: 20000
      });
      // york 编辑器为自研块编辑器（contenteditable），合成 paste 识别；Quill 兜底
      // ⓪ 图片直传：先把文章外链图重传到 B站图床（hdslb.com/bfs/article），
      //    平台拒收外链图时由此兜底；失败自动保留原链接
      let mdB0 = ctx.markdown;
      try {
        if (U.rehostMdImages && /!\[[^\]]*\]\((https?:)/.test(mdB0)) {
          mdB0 = await U.rehostMdImages(mdB0, uploadImageToBilibili, (l, m) => adapterLog('bilibili', l, m));
        }
      } catch (_) { mdB0 = ctx.markdown; }
      // 公式预处理：york 编辑器不解析 LaTeX，先转 codecogs PNG 公式图；
      // 无公式且无重传时返回原文，仍走原 html 保持旧行为不变
      let mdB = U.latexMdToImg(mdB0);
      // 公式图也直传：B站可能拒收 codecogs 外链（防盗链），与正文图同一上传函数
      try {
        if (U.rehostCodecogsImages && mdB !== mdB0 && /latex\.codecogs\.com/.test(mdB)) {
          mdB = await U.rehostCodecogsImages(mdB, uploadImageToBilibili, (l, m) => adapterLog('bilibili', l, m));
        }
      } catch (_) { /* 失败保留 codecogs 原链接，继续原有流程 */ }
      let htmlB;
      if (mdB !== ctx.markdown) {
        htmlB = U.mdToHtmlNoBreaks(mdB);
        // 重算的 HTML 必须补套主题（v9 §2.1：公式/重传分支都要补），否则主题样式丢失
        const themeB = ctx.themeId && (self.MULTIPOST_THEMES || []).find((t) => t.id === ctx.themeId);
        if (themeB && self.MULTIPOST_APPLY_THEME) htmlB = self.MULTIPOST_APPLY_THEME(htmlB, themeB);
      } else {
        htmlB = ctx.htmlNoBr || ctx.html;
      }
      const rich = await U.fillRichText({
        html: htmlB,
        text: ctx.markdown,
        directHtml: true,
        selectors: [
          '.ql-editor[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          '.b-read-editor .ql-editor[contenteditable="true"]',
          'div[contenteditable="true"][class*="editor" i]',
          'div[contenteditable="true"][data-placeholder]',
          'div[contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 百家号（实验性） ---------------- */
  const baijiahao = {
    id: 'baijiahao',
    name: '百家号',
    hosts: ['baijiahao.baidu.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页
      if (/\/login|passport\.baidu\.com/.test(location.href)) {
        return { ok: false, message: '百家号未登录，请先登录 baijiahao.baidu.com 后重试' };
      }
      // 标题选择器随改版易失效：选择器超时后用特征查找兜底
      // （编辑区顶部、宽度足够的可见单行输入框/标题 contenteditable）
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          '.title-input input',
          '#title',
          'div[contenteditable="true"][class*="title" i]'
        ],
        timeout: 20000,
        finder: baijiahaoTitleFinder
      });
      // 百家号图文编辑器为自研富文本（contenteditable），合成 paste 多数可识别
      // 公式预处理：百家号不解析 LaTeX（实测 $$...$$ 原样显示），先转 PNG 公式图；
      // 无公式时 latexMdToImg 返回原文，仍走原 html 保持旧行为不变
      const mdBj = U.latexMdToImg(ctx.markdown);
      const rich = await U.fillRichText({
        html: mdBj !== ctx.markdown ? U.mdToHtmlNoBreaks(mdBj) : (ctx.htmlNoBr || ctx.html),
        text: ctx.markdown,
        directHtml: true,
        selectors: [
          '.editor-container [contenteditable="true"]',
          '[class*="editor"] [contenteditable="true"]',
          'div[contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /** 百家号标题特征查找：编辑区顶部 50%、宽度 > 200px、高度 < 100px 的可编辑元素 */
  function baijiahaoTitleFinder() {
    const els = document.querySelectorAll(
      'input[type="text"], input:not([type]), textarea, div[contenteditable="true"]'
    );
    for (const el of els) {
      try {
        if (!U.isVisible(el)) continue;
        const ph = el.getAttribute('placeholder') || '';
        if (ph && /标题/.test(ph)) return el;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height > 100) continue;
        if (r.top > window.innerHeight * 0.5) continue; // 标题位于编辑区顶部
        // 排除正文编辑器容器内的 contenteditable
        if (el.tagName === 'DIV' && el.isContentEditable &&
            el.closest('[class*="editor" i]')) continue;
        return el;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  /* ---------------- 51CTO博客（实验性） ---------------- */
  const cto51 = {
    id: 'cto51',
    name: '51CTO博客',
    hosts: ['blog.51cto.com'],
    experimental: true,
    async fill(ctx) {
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input#title',
          'input[placeholder*="标题"]',
          'input[name="title"]'
        ],
        timeout: 20000
      });
      // 51CTO 悟空编辑器：Markdown 模式为 textarea（placeholder=请输入正文），富文本模式为 contenteditable
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea[placeholder*="正文"]',
          'textarea[name*="content"]',
          '.cm-content[contenteditable="true"]',
          'textarea'
        ],
        timeout: 15000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          directHtml: true,
          selectors: [
            '[class*="editor"] [contenteditable="true"]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 开源中国（实验性） ---------------- */
  const oschina = {
    id: 'oschina',
    name: '开源中国',
    hosts: ['my.oschina.net'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页
      if (/\/login|signin/.test(location.pathname)) {
        return { ok: false, message: '开源中国未登录，请先登录 my.oschina.net 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input#title',
          'input[placeholder*="标题"]',
          'input[name="title"]'
        ],
        timeout: 20000
      });
      // Markdown 模式：#mdeditor textarea（CodeMirror）；富文本模式：UEditor iframe
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          'textarea#mdeditor',
          '#mdeditor',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[name="content"]'
        ],
        timeout: 15000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          selectors: [
            'iframe[id^="ueditor"]',
            '[contenteditable="true"].edui-body-container',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 腾讯云开发者社区（实验性） ---------------- */
  const tencentcloud = {
    id: 'tencentcloud',
    name: '腾讯云社区',
    hosts: ['cloud.tencent.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页
      if (/\/login|signin/.test(location.pathname)) {
        return { ok: false, message: '腾讯云社区未登录，请先登录 cloud.tencent.com 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'textarea[placeholder="请输入标题"]',
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]'
        ],
        timeout: 25000
      });
      // write-new 编辑器可能为 CodeMirror（主世界 CM6 直写优先），
      // 也可能改版为富文本 contenteditable —— 两种都兜住
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          '.cm-content[contenteditable="true"]',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[placeholder*="正文"], textarea[placeholder*="markdown" i]'
        ],
        timeout: 25000
      }).then(async (res) => {
        if (res.ok) return res;
        // 富文本编辑器兜底（改版后的 write-new 为自研富文本）。
        // 0.4.11 页面存档确认：新版正文编辑器为 Tiptap/ProseMirror ——
        //   <div contenteditable="true" id="cdc-rich-editor"
        //        class="tiptap ProseMirror cdc-rich-editor"
        //        data-placeholder 内容为「请输入内容」>
        // 精确选择器放最前；Markdown/CodeMirror 落空时优先命中真实门牌号。
        // 兜底超时 10s→20s：新编辑器挂载较慢，10s 曾不够
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 20000,
          directHtml: true,
          selectors: [
            '#cdc-rich-editor',
            '.cdc-rich-editor.ProseMirror',
            'div[contenteditable="true"][class*="editor" i]',
            '.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"][data-placeholder]',
            'div[contenteditable="true"]'
          ]
        });
        // 两种编辑器都落空时合并两路消息：只透传 Markdown 一路的"未找到 Markdown
        // 编辑器"会掩盖富文本兜底的真实失败原因（页面可编辑元素诊断串在 rich.message 里）
        return rich.ok ? rich : { ok: false, message: res.message + '；富文本兜底：' + rich.message };
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 阿里云开发者社区（实验性） ---------------- */
  const aliyun = {
    id: 'aliyun',
    name: '阿里云社区',
    hosts: ['developer.aliyun.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会被重定向到登录页（标题/编辑器都找不到的常见原因）
      if (/\/login|signin/.test(location.pathname)) {
        return { ok: false, message: '阿里云社区未登录，请先登录 developer.aliyun.com 后重试' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input.article-title',
          '#title'
        ],
        timeout: 25000
      });
      // 阿里云博文默认 Markdown 编辑器（含 CodeMirror 变体），富文本（语雀）兜底
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: [
          '.cm-content[contenteditable="true"]',
          '.cm-editor .cm-content[contenteditable="true"]',
          '.CodeMirror .cm-content[contenteditable="true"]',
          'textarea[placeholder*="正文"], textarea[placeholder*="markdown" i]',
          'textarea'
        ],
        timeout: 25000
      }).then(async (res) => {
        if (res.ok) return res;
        const rich = await U.fillRichText({
          html: ctx.html,
          text: ctx.markdown,
          timeout: 8000,
          directHtml: true,
          selectors: [
            '[class*="editor"] [contenteditable="true"]',
            'div[contenteditable="true"]'
          ]
        });
        return rich.ok ? rich : res;
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 本地演示页 ---------------- */
  const demo = {
    id: 'demo',
    name: '本地演示页',
    hosts: ['localhost', '127.0.0.1'],
    match(url) {
      return /(^|\.)localhost$/.test(location.hostname) && location.port === '8788';
    },
    async fill(ctx) {
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: ['#demo-title'],
        timeout: 10000
      });
      const body = await U.fillMarkdown({
        markdown: ctx.markdown,
        selectors: ['#demo-content'],
        timeout: 10000
      });
      return { ok: title.ok && body.ok, message: [title.ok ? '' : title.message, body.ok ? '' : body.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 小红书长文（实验性） ---------------- */
  const xiaohongshu = {
    id: 'xiaohongshu',
    name: '小红书长文',
    hosts: ['creator.xiaohongshu.com'],
    experimental: true,
    async fill(ctx) {
      // 未登录会跳登录页
      if (/login/.test(location.href)) {
        return { ok: false, message: '小红书未登录，请先登录 creator.xiaohongshu.com 后重试' };
      }
      // 创作平台默认落在"上传视频"tab，需要切到「写长文」
      const tab = await U.waitFor(() => {
        const els = document.querySelectorAll('div,span,[role="tab"]');
        for (const e of els) {
          const t = (e.textContent || '').trim();
          if (t === '写长文' || t === '长文') {
            try { return U.isVisible(e) && e.children.length === 0 ? e : null; } catch (_) { return null; }
          }
        }
        return null;
      }, { timeout: 8000 });
      if (tab) { try { tab.click(); } catch (_) { /* ignore */ } await U.sleep(1800); }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input[placeholder*="输入标题"]',
          'div[contenteditable="true"][class*="title" i]'
        ],
        timeout: 15000
      });
      // 长文正文为富文本 contenteditable（Quill/TipTap 系）；选择器全部落空时
      // fillRichText 内部还有"深度发现"兜底（枚举全页可编辑元素逐个试粘贴）
      const rich = await U.fillRichText({
        html: ctx.htmlNoBr || ctx.html,
        text: ctx.markdown,
        directHtml: true,
        timeout: 20000,
        selectors: [
          '.ql-editor[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          'div[contenteditable="true"][data-placeholder]',
          'div[contenteditable="true"][class*="editor" i]',
          'div[contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ---------------- 抖音长文（实验性） ---------------- */
  const douyin = {
    id: 'douyin',
    name: '抖音长文',
    hosts: ['creator.douyin.com'],
    experimental: true,
    async fill(ctx) {
      // 抖音偶尔要求手机号/账号安全验证（CSDN 同步助手同样处理过该拦截页）
      const pageText = (document.body && document.body.innerText) || '';
      if (/verification/.test(location.href) || /完成安全验证|安全验证/.test(pageText.slice(0, 800))) {
        return { ok: false, message: '抖音要求安全验证，请人工完成验证后在本页重新同步' };
      }
      // 不在长文页则先路由过去（跳转后新页面的内容脚本会重新领任务继续填）
      if (!/post\/article/.test(location.pathname)) {
        location.href = 'https://creator.douyin.com/creator-micro/content/post/article';
        return { ok: false, silent: true, message: '正在进入抖音长文编辑页…' };
      }
      const title = await U.fillTitle({
        title: ctx.title,
        selectors: [
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'div[contenteditable="true"][class*="title" i]'
        ],
        timeout: 20000
      });
      const rich = await U.fillRichText({
        html: ctx.htmlNoBr || ctx.html,
        text: ctx.markdown,
        directHtml: true,
        timeout: 20000,
        selectors: [
          '.ProseMirror[contenteditable="true"]',
          '.ql-editor[contenteditable="true"]',
          'div[contenteditable="true"][data-placeholder]',
          'div[contenteditable="true"][class*="editor" i]',
          'div[contenteditable="true"]'
        ]
      });
      return { ok: title.ok && rich.ok, message: [title.ok ? '' : title.message, rich.ok ? '' : rich.message].filter(Boolean).join('；') };
    }
  };

  /* ============ 统一「封面 + 标签」挂载（第一期：知乎 / B站 / CSDN） ============
   * 用装饰器包一层 fill：正文填充成功后，尽力设置封面与标签。
   * 任一环节失败只记日志并在消息里附注，绝不改变正文填充的 ok 结果。 */
  const COVER_TAG_UPLOADERS = {
    zhihu: uploadImageToZhihu,
    bilibili: uploadImageToBilibili,
    csdn: uploadImageToCsdn
  };
  function withCoverAndTags(adapter) {
    const upload = COVER_TAG_UPLOADERS[adapter.id];
    if (!upload) return adapter;
    const rawFill = adapter.fill.bind(adapter);
    adapter.fill = async function (ctx) {
      const res = await rawFill(ctx);
      if (!res || res.ok !== true) return res;
      try {
        if (!ctx.cover && !ctx.coverFromArticle && !(ctx.tags && ctx.tags.length)) return res;
        let coverDataUrl = ctx.cover || null;
        if (!coverDataUrl && ctx.coverFromArticle) {
          coverDataUrl = await U.getCoverDataUrlFromArticle(ctx.markdown, (l, m) => adapterLog(adapter.id, l, m));
        }
        const note = await U.fillCoverAndTags({
          coverDataUrl,
          coverUploader: upload,
          tags: ctx.tags || [],
          log: (l, m) => adapterLog(adapter.id, l, m)
        });
        if (note) res.message = (res.message ? res.message + '；' : '') + note;
      } catch (e) {
        adapterLog(adapter.id, 'warn', '封面/标签设置异常（不影响正文）：' + ((e && e.message) || e));
      }
      return res;
    };
    return adapter;
  }

  self.__MULTIPOST_ADAPTERS__ = [
    zhihu, juejin, csdn, weixin, toutiao, jianshu, cnblogs,
    bilibili, baijiahao, cto51, oschina, tencentcloud, aliyun,
    xiaohongshu, douyin, demo
  ].map(withCoverAndTags);
})();
