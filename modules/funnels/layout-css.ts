/**
 * The public funnel layout: the classic video-series page. One centred 960px
 * column shared by the header, the module navigation and the content (so their
 * edges always line up), a framed 16:9 video, previous / next buttons on the
 * left / right under it, resources in a centred column, a plain footer.
 * Colours come from the design CSS (`designCss`), which is written after this
 * and wins. PURE: a constant stylesheet with no interpolated input.
 */
export const LAYOUT_CSS = `
.pcf{min-height:100vh;display:flex;flex-direction:column}
.pcf *,.pcf *::before,.pcf *::after{box-sizing:border-box}
.pcf-wrap{width:100%;max-width:960px;margin:0 auto;padding-left:16px;padding-right:16px}
.pcf-header{position:relative;z-index:2;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.pcf-main{flex:1;min-width:0}

.pcf-nav{background:#f2f2f2;padding:12px 0 10px}
.pcf-nav-row{display:flex;gap:14px;justify-content:safe center;overflow-x:auto;scrollbar-width:thin;list-style:none;margin:0 auto;padding:8px 8px 6px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.pcf-nav-row>li{flex:0 0 auto;scroll-snap-align:center}
.pcf-tile{display:block;width:var(--pcf-thumb-w,160px);text-align:center;text-decoration:none;color:var(--pcf-nav-text,inherit);transition:opacity .15s}
.pcf-thumb{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;background:#cfd4da;transition:transform .15s}
.pcf-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.pcf-tile[aria-current="page"] .pcf-thumb{transform:scale(1.04)}
.pcf-ph{display:grid;place-items:center;height:100%;font-size:24px;font-weight:800;color:#fff;background:var(--pcf-header-bg,#222)}
.pcf-ph.is-custom{font-size:22px;background:#cfd4da}
.pcf-lock{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);color:#fff}
.pcf-lock-badge{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.6);border:1.5px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.35)}
.pcf-live-badge{position:absolute;top:5px;left:5px;background:#dc2626;color:#fff;font:800 10px/1 sans-serif;padding:3px 5px;border-radius:3px;letter-spacing:.06em}
.pcf-tile-label{display:block;margin-top:8px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.pcf-day{padding-top:34px;padding-bottom:50px}
.pcf-title{text-align:center;font-size:clamp(24px,4.2vw,38px);font-weight:800;line-height:1.18;margin:0 0 24px;overflow-wrap:anywhere}
.pcf-frame{background:#f4f4f4;border:1px solid #e3e3e3;padding:20px}
.pcf-frame-inner{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden}
.pcf-frame-inner>.pcf-player{position:absolute;inset:0}
.pcf-ph-box{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;text-align:center;background:#1f2937;color:#fff}
.pcf-ph-lock{display:grid;place-items:center;width:84px;height:84px;margin:0 auto 14px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid currentColor}
.pcf-ph-title{margin:4px 0;font-size:clamp(20px,3.4vw,30px);font-weight:800;line-height:1.2}
.pcf-ph-msg{margin:0 0 12px;max-width:520px;font-size:16px;line-height:1.45;opacity:.85}
.pcf-live{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;background:#111;color:#fff}
.pcf-live-dot{width:18px;height:18px;margin:0 auto 16px;border-radius:50%;background:#ef4444;animation:pcf-pulse 1.2s infinite}
.pcf-live-h{margin:0 0 6px;font-size:clamp(30px,6vw,54px);font-weight:900;line-height:1.1}
.pcf-live-sub{margin:0 0 22px;font-size:18px;opacity:.85}
@keyframes pcf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.7)}50%{box-shadow:0 0 0 14px rgba(239,68,68,0)}}

.pcf-row{display:flex;justify-content:flex-end;margin-top:10px}
.pcf-row.is-prev{justify-content:flex-start}
.pcf-next{display:inline-block;background:#f4f4f4;border:1px solid #ddd;color:#333;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:13px 30px}
.pcf-next:hover{background:#ebebeb}
.pcf-cta{text-align:center;margin:34px 0 10px}
.pcf-cta .pcf-btn{font-size:clamp(18px,2.6vw,24px);padding:20px 44px;box-shadow:0 6px 18px rgba(0,0,0,.18)}
.pcf-cta-sub{margin:10px 0 0;font-size:13.5px;opacity:.7}
.pcf-resources{text-align:center;margin-top:56px}
.pcf-res-h{margin:0 0 16px;font-size:clamp(20px,3vw,28px);font-weight:800}
.pcf-res-list{display:flex;flex-direction:column;align-items:center;gap:12px;list-style:none;margin:0;padding:0}
.pcf-res-list .pcf-btn{font-size:clamp(16px,2.4vw,22px);padding:15px 60px}
.pcf-res-link{color:var(--pcf-accent);font-weight:600;font-size:16px}
.pcf-below{margin-top:24px}
.pcf-text{font-size:17px;line-height:1.65}

.pcf-countdown{display:flex;justify-content:center;gap:clamp(8px,2vw,20px);flex-wrap:wrap}
.pcf-cd-box{width:clamp(72px,19vw,170px);padding:clamp(12px,2.5vw,26px) 6px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center}
.pcf-cd-num{display:block;font-size:clamp(38px,9vw,104px);font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
.pcf-cd-label{display:block;margin-top:8px;font-size:clamp(10px,1.6vw,14px);font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.7}
.pcf-countdown.is-box{gap:10px;margin:6px 0 14px;flex-wrap:nowrap}
.pcf-countdown.is-box .pcf-cd-box{width:clamp(64px,14vw,110px);padding:12px 4px;box-shadow:none}
.pcf-countdown.is-box .pcf-cd-num{font-size:clamp(28px,6vw,56px)}
.pcf-countdown.is-box .pcf-cd-label{font-size:10.5px}

.pcf-landing{padding:54px 0 64px;text-align:center;background-size:cover;background-position:center}
.pcf-landing-logo{display:block;width:auto;max-width:100%;height:auto;margin:0 auto 26px}
.pcf-cta .pcf-btn,.pcf-res-list .pcf-btn,.pcf-homework .pcf-btn,.pcf-live .pcf-btn{text-transform:uppercase;letter-spacing:.02em}
.pcf-landing-h{margin:0 0 12px;font-size:clamp(28px,5.4vw,56px);font-weight:900;line-height:1.1;overflow-wrap:anywhere}
.pcf-landing-sub{max-width:680px;margin:0 auto 32px;font-size:clamp(16px,2.2vw,20px);line-height:1.45;opacity:.85}
.pcf-landing-when{margin:26px 0 0;font-size:17px;font-weight:600;opacity:.9}
.pcf-landing-action{margin-top:16px;text-align:center}
.pcf-landing-action:empty{display:none}
.pcf-homework{max-width:640px;margin:34px auto 0;padding:26px clamp(18px,4vw,34px) 28px;border-radius:12px;border:1px solid rgba(127,127,127,.3);border-top:4px solid var(--pcf-accent);background:rgba(127,127,127,.08);box-shadow:0 12px 34px rgba(0,0,0,.18)}
.pcf-hw-badge{display:inline-block;margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--pcf-accent)}
.pcf-hw-h{margin:0 0 8px;font-size:clamp(22px,3.4vw,30px);font-weight:800}
.pcf-hw-sub{margin:0 0 18px;font-size:clamp(15px,2vw,18px);line-height:1.45;opacity:.85}

.pcf-agenda{padding:56px 0 64px}
.pcf-agenda-h{margin:0 0 30px;text-align:center;font-size:clamp(24px,4vw,36px);font-weight:800}
.pcf-agenda-list{list-style:none;margin:0 auto;padding:0;max-width:760px}
.pcf-agenda-item{display:flex;gap:20px;padding:20px 0;border-bottom:1px solid rgba(127,127,127,.25)}
.pcf-agenda-item:last-child{border-bottom:0}
.pcf-agenda-item.is-current{border-radius:8px;padding-left:12px;padding-right:12px;background:rgba(127,127,127,.1)}
.pcf-agenda-item.is-faded{opacity:.8}
.pcf-agenda-day{flex:0 0 96px;padding-top:4px;font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--pcf-accent)}
.pcf-agenda-body{flex:1;min-width:0}
.pcf-agenda-title{margin:0 0 4px;font-size:20px;font-weight:800;overflow-wrap:anywhere}
.pcf-agenda-title a{color:inherit;text-decoration:none;border-bottom:1px dashed currentColor}
.pcf-agenda-when{margin-bottom:8px;font-size:14px;opacity:.7}
.pcf-agenda-topics{margin:6px 0 0;padding-left:20px;line-height:1.55}
.pcf-tag{display:inline-block;margin-left:8px;padding:3px 6px;border-radius:3px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;vertical-align:middle;white-space:nowrap;color:#fff;background:#dc2626}
.pcf-tag.is-here{background:var(--pcf-accent);color:var(--pcf-accent-text)}
.pcf-agenda-box{margin:26px 0 8px;padding:clamp(18px,3.5vw,30px);border:1px solid rgba(15,23,42,.1);border-radius:12px;box-shadow:0 8px 26px rgba(15,23,42,.06)}
.pcf-agenda-box .pcf-agenda-h{margin:0 0 6px;font-size:clamp(20px,3vw,26px)}
.pcf-agenda-box .pcf-agenda-list{max-width:none}
.pcf-agenda-box .pcf-agenda-item{padding:14px 0}
.pcf-sched{list-style:none;margin:0 auto;padding:0;max-width:760px;display:flex;flex-direction:column;gap:14px;text-align:left}
.pcf-sched-item{display:flex;gap:18px;align-items:flex-start;padding:14px;border:1px solid rgba(127,127,127,.28);border-radius:10px;background:rgba(127,127,127,.07)}
.pcf-sched-item.is-current{border-color:var(--pcf-accent)}
.pcf-sched-thumb{flex:0 0 min(220px,36%);display:block;border-radius:6px;overflow:hidden;line-height:0}
.pcf-sched-thumb img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.pcf-sched-body{flex:1;min-width:0}
.pcf-sched-eyebrow{margin-bottom:6px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--pcf-accent)}
.pcf-sched-title{margin:0 0 6px;font-size:20px;font-weight:800;line-height:1.25}
.pcf-sched-title a{color:inherit;text-decoration:none}

.pcf-hosts{padding:56px 0 64px}
.pcf-message{padding:70px 16px;text-align:center}
.pcf-footer{border-top:2px solid #e5e5e5;padding:34px 0 42px;text-align:center;font-size:14px}

.pcf-cal{position:relative;display:inline-block}
.pcf-cal>summary{list-style:none;cursor:pointer}
.pcf-cal>summary::-webkit-details-marker{display:none}

.pcf-flip{display:flex;justify-content:center;align-items:flex-start;gap:4px;--t-w:36px;--t-h:48px;--t-f:30px}
.pcf-flip.is-sm{--t-w:24px;--t-h:34px;--t-f:21px}
.pcf-flip.is-lg{--t-w:clamp(38px,6vw,60px);--t-h:clamp(52px,8.2vw,82px);--t-f:clamp(30px,5vw,52px)}
.pcf-flip-unit-wrap{display:flex;align-items:flex-start;gap:4px}
.pcf-flip-unit{display:flex;flex-direction:column;align-items:center;gap:6px}
.pcf-flip-digits{display:flex;gap:4px;perspective:200px}
.pcf-flip-tile{display:grid;place-items:center;width:var(--t-w);height:var(--t-h);border-radius:6px;font-size:var(--t-f);font-weight:700;line-height:1;font-variant-numeric:tabular-nums;box-shadow:inset 0 calc(var(--t-h) / -2) 0 rgba(0,0,0,.16);animation:pcf-flip .32s ease-out}
.pcf-flip-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.pcf-flip-colon{font-size:var(--t-f);line-height:var(--t-h);opacity:.8;padding:0 1px}
@keyframes pcf-flip{from{transform:rotateX(-75deg);opacity:.35}to{transform:none;opacity:1}}

.pcf-day.is-split{max-width:1440px}
.pcf-split{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
.pcf-split-main{flex:999 1 600px;min-width:0}
.pcf-eplist-nav{flex:1 1 320px;min-width:0;max-width:440px}
.pcf-eplist{max-height:min(680px,85vh);overflow-y:auto;border-radius:12px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.07);list-style:none;margin:0;padding:0}
.pcf-ep{display:flex;gap:12px;padding:12px;border-bottom:1px solid rgba(127,127,127,.2);text-decoration:none;color:inherit}
a.pcf-ep:hover{background:rgba(127,127,127,.1)}
.pcf-ep[aria-current="page"]{background:rgba(127,127,127,.18)}
.pcf-ep-thumb{position:relative;flex:0 0 clamp(96px,34%,132px);aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:#cfd4da}
.pcf-ep-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.pcf-ep-thumb.is-blur img{filter:blur(7px);transform:scale(1.12)}
.pcf-ep-play{position:absolute;left:6px;bottom:6px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--pcf-accent);color:#fff}
.pcf-ep-body{display:flex;flex-direction:column;gap:3px;min-width:0}
.pcf-ep-label{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
.pcf-ep-title{font-size:15px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.pcf-ep-status{font-size:13px;opacity:.8}
.pcf-ep-status.is-now{opacity:1;font-weight:700;color:var(--pcf-accent)}

.pcf-downloads{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.pcf-dl{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:8px;border:1px solid rgba(127,127,127,.35);color:inherit;text-decoration:none;font-size:14px;font-weight:600}
.pcf-dl.is-locked{opacity:.8}
.pcf-res-list:has(.pcf-dl){flex-direction:row;flex-wrap:wrap;justify-content:center;gap:8px}
.pcf-dl:hover{border-color:currentColor;opacity:1}

.pcf-ph-box.is-minimal{justify-content:center}
.pcf-offer{scroll-margin-top:110px}
.pcf-tiers{display:grid;gap:20px;align-items:start;text-align:left}
.pcf-tier{display:flex;flex-direction:column;gap:14px;padding:26px;border-radius:14px;border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.06)}
.pcf-tier.is-on{border:2px solid var(--pcf-accent)}
.pcf-tier-badge{font-size:12px;font-weight:800;letter-spacing:.04em;padding:4px 10px;border-radius:99px;background:var(--pcf-accent);color:var(--pcf-accent-text,#fff)}
.pcf-bonus{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;background:rgba(127,127,127,.1);font-size:14px}
.pcf-stars{color:#f2b43a;letter-spacing:2px;font-size:18px}
.pcf-faq{border:1px solid rgba(127,127,127,.28);border-radius:12px;overflow:hidden}
.pcf-faq details{border-bottom:1px solid rgba(127,127,127,.2)}
.pcf-faq details:last-child{border-bottom:0}
.pcf-faq summary{display:flex;justify-content:space-between;gap:16px;min-height:52px;align-items:center;padding:14px 18px;cursor:pointer;font-weight:700;list-style:none}
.pcf-faq summary::-webkit-details-marker{display:none}
.pcf-faq details[open] .pcf-faq-mark{transform:rotate(45deg)}
.pcf-faq-mark{font-size:22px;transition:transform .15s}
.pcf-faq p{margin:0;padding:0 18px 16px;opacity:.9}
.pcf-more>:first-child>:nth-child(n+7){display:none}

.pcf-topbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 20px}
.pcf-topbar-clock{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 16px}
.pcf-topbar-text{font-size:20px;font-weight:700}
.pcf-topbar-btn{white-space:nowrap}

@media (max-width:600px){
  .pcf-eplist{max-height:none}
  .pcf-eplist-nav{max-width:none}
  .pcf-topbar{justify-content:center}
  .pcf-topbar-logo{display:none}
  .pcf-topbar-clock{flex-direction:column;gap:8px}
  .pcf-topbar-text{font-size:22px;text-align:center}
  .pcf-tier{padding:20px}
  .pcf-nav{padding:6px 0}
  .pcf-nav-row{gap:10px;justify-content:flex-start;scrollbar-width:none;padding:6px 6px 4px}
  .pcf-nav-row::-webkit-scrollbar{display:none}
  .pcf-tile{width:min(var(--pcf-thumb-w,160px),120px)}
  .pcf-tile[aria-current="page"] .pcf-thumb{transform:none}
  .pcf-tile-label{margin-top:6px;font-size:10.5px;letter-spacing:.08em}
  .pcf-lock-badge{width:30px;height:30px}
  .pcf-day{padding-top:20px;padding-bottom:36px}
  .pcf-title{margin-bottom:16px}
  .pcf-frame{padding:0;border:0;margin:0 -16px}
  .pcf-frame.is-ph .pcf-frame-inner{aspect-ratio:auto;min-height:56vw}
  .pcf-frame.is-ph .pcf-ph-box,.pcf-frame.is-ph .pcf-live{position:relative;min-height:56vw}
  .pcf-ph-box{padding:16px}
  .pcf-ph-lock{width:62px;height:62px}
  .pcf-ph-msg{font-size:14.5px;margin-bottom:8px}
  .pcf-row{justify-content:stretch;margin-top:12px}
  .pcf-next{flex:1;text-align:center;padding:14px 16px}
  .pcf-cta{margin-top:24px}
  .pcf-cta .pcf-btn{display:flex;width:100%;padding:17px 16px;font-size:18px}
  .pcf-resources{margin-top:36px}
  .pcf-res-list{align-items:stretch}
  .pcf-res-list .pcf-btn{width:100%;padding:15px 16px;font-size:16px}
  .pcf-live{padding:36px 16px}
  .pcf-message{padding:44px 16px}
  .pcf-footer{padding:26px 0 32px;font-size:13px}
  .pcf-landing{padding:34px 0 40px}
  .pcf-landing-sub{margin-bottom:22px}
  .pcf-countdown{gap:6px;flex-wrap:nowrap}
  .pcf-cd-box{width:auto;flex:1 1 0;min-width:0;border-radius:9px;padding:12px 2px}
  .pcf-cd-num{font-size:clamp(30px,11vw,48px)}
  .pcf-cd-label{font-size:9.5px;letter-spacing:.08em}
  .pcf-landing-when{margin-top:18px;font-size:15px}
  .pcf-homework{margin-top:24px;padding:20px 16px 22px}
  .pcf-agenda,.pcf-hosts{padding:36px 0 40px}
  .pcf-agenda-h{margin-bottom:16px}
  .pcf-agenda-item{flex-direction:column;gap:4px;padding:16px 0}
  .pcf-agenda-day{flex:none}
  .pcf-agenda-title{font-size:18px}
  .pcf-sched-item{flex-direction:column;gap:10px;padding:12px}
  .pcf-sched-thumb{flex:none;width:100%}
}
@media (prefers-reduced-motion:reduce){.pcf-live-dot,.pcf-flip-tile{animation:none}}
`;
