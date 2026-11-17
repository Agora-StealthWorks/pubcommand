/**
 * The "Send to Research Extractor" bookmarklet and the capture page it opens.
 * The bookmarklet runs on the page someone is reading, so it works on pages
 * our server cannot fetch (bot walls, script-built articles, logins they
 * have). It carries no credentials: it hands the text to the capture page by
 * postMessage, and the capture page saves it as the signed-in user.
 */

export const CAPTURE_MIN_CHARS = 200;
export const CAPTURE_MAX_CHARS = 400_000;

export type CapturePayload = { title: string; url: string | null; text: string };

/**
 * Validate a postMessage payload. The nonce ties it to the tab the bookmarklet
 * opened, so an unrelated page cannot push text in; the text is data only.
 */
export function parseCapturePayload(data: unknown, nonce: string): { ok: true; payload: CapturePayload } | { ok: false; reason: string } {
  if (!data || typeof data !== "object") return { ok: false, reason: "not a capture message" };
  const d = data as Record<string, unknown>;
  if (d.__pcCapture !== 1) return { ok: false, reason: "not a capture message" };
  if (!nonce || typeof d.nonce !== "string" || d.nonce !== nonce) return { ok: false, reason: "wrong tab" };
  const text = typeof d.text === "string" ? d.text.replace(/\r\n/g, "\n").trim() : "";
  if (text.length < CAPTURE_MIN_CHARS) return { ok: false, reason: "too little text" };
  const rawUrl = typeof d.url === "string" ? d.url.trim() : "";
  let url: string | null = null;
  try {
    const parsed = new URL(rawUrl);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password) url = parsed.toString().slice(0, 2000);
  } catch {
    url = null;
  }
  const title = (typeof d.title === "string" ? d.title : "").replace(/\s+/g, " ").trim().slice(0, 200);
  return { ok: true, payload: { title, url, text: text.slice(0, CAPTURE_MAX_CHARS) } };
}

/** A nonce must look like what the bookmarklet makes, so a crafted hash cannot inject markup. */
export function isNonce(value: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(value);
}

/**
 * The bookmarklet source for one organization's address. A selection wins;
 * otherwise <article>, then <main>, then the body. It retries the hand-off
 * until the capture tab acknowledges, then stops.
 */
export function bookmarkletCode(origin: string): string {
  const target = new URL(origin).origin;
  const js = `(function(){var A=${JSON.stringify(target)};var s=String(window.getSelection?window.getSelection():'').trim();function T(e){return e?(e.innerText||'').trim():''}var b=s||T(document.querySelector('article'))||T(document.querySelector('main'))||T(document.body);if(!b||b.length<${CAPTURE_MIN_CHARS}){alert('No article text found on this page. Select the text first, then try again.');return}var t='';var m=document.querySelector('meta[property="og:title"]');if(m){t=m.getAttribute('content')||''}if(!t){t=document.title||''}var c=document.querySelector('link[rel=canonical]');var u=(c&&c.href)||location.href;var n=Math.random().toString(36).slice(2,14);var w=window.open(A+'/research/capture#'+n,'_blank');if(!w){alert('Allow pop-ups for this site, then try again.');return}var p={__pcCapture:1,nonce:n,title:t,url:u,text:b.slice(0,${CAPTURE_MAX_CHARS})};var k=0;var iv=setInterval(function(){k++;try{w.postMessage(p,A)}catch(e){}if(k>60){clearInterval(iv)}},500);window.addEventListener('message',function(e){if(e.origin===A&&e.data&&e.data.__pcCaptureAck===n){clearInterval(iv)}})})();`;
  return `javascript:${js}`;
}
