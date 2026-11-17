/**
 * Layout for rich text the editor wrote (image wrap and width, embeds,
 * highlights). Typography stays with each app; this only covers the classes
 * the editor emits. Scope it with a class (default `.rte-content`).
 */
export function richContentCss(scope = ".rte-content"): string {
  const s = scope;
  return [
    `${s}::after{content:"";display:table;clear:both}`,
    `${s} img{max-width:100%;height:auto}`,
    `${s} img.rte-img-left{float:left;margin:.25rem 1.25rem .75rem 0}`,
    `${s} img.rte-img-right{float:right;margin:.25rem 0 .75rem 1.25rem}`,
    `${s} img.rte-img-center{display:block;margin:.75rem auto}`,
    `${s} img.rte-img-full{display:block;width:100%;margin:.75rem 0}`,
    `${s} img.rte-w-25{width:25%}`,
    `${s} img.rte-w-33{width:33%}`,
    `${s} img.rte-w-50{width:50%}`,
    `${s} img.rte-w-75{width:75%}`,
    `${s} img.rte-w-100{width:100%}`,
    `@media (max-width:480px){${s} img.rte-img-left,${s} img.rte-img-right{float:none;display:block;margin:.75rem auto;width:100%}}`,
    `${s} .rte-embed{position:relative;width:100%;aspect-ratio:16/9;margin:1rem 0;clear:both}`,
    `${s} .rte-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:8px}`,
    `${s} mark{padding:0 .15em;border-radius:2px}`,
    `${s} blockquote{border-left:4px solid currentColor;padding-left:.75rem;opacity:.9}`,
    `${s} hr{margin:1.25rem 0;border:0;border-top:1px solid rgba(0,0,0,.15)}`,
  ].join("\n");
}

/** A `<style>` with the rich-content rules (render once per page). */
export function RichContentStyles({ scope = ".rte-content" }: { scope?: string }) {
  return <style dangerouslySetInnerHTML={{ __html: richContentCss(scope) }} />;
}
