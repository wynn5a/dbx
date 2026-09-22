import { defineAsyncComponent, h } from "vue";
import { Loader2 } from "@lucide/vue";

// QueryEditor (and through it the CodeMirror chunk) must stay out of the
// startup graph: ContentArea and ObjectBrowser mount it lazily so browse-only
// sessions never pay for the editor. The promise is memoized like the DataGrid
// loader in ContentArea so concurrent mounts share one chunk load and the
// [DBX][QueryEditor:load:*] timing is logged exactly once.
let queryEditorComponentPromise: Promise<typeof import("./QueryEditor.vue")> | undefined;

export function loadQueryEditorComponent() {
  if (!queryEditorComponentPromise) {
    queryEditorComponentPromise = (async () => {
      const startedAt = performance.now();
      console.info("[DBX][QueryEditor:load:start]");
      const component = await import("./QueryEditor.vue");
      console.info("[DBX][QueryEditor:load:done]", { elapsed: `${Math.round(performance.now() - startedAt)}ms` });
      return component;
    })();
  }
  return queryEditorComponentPromise;
}

// Fills the editor's flex area while the chunk loads so nothing collapses or
// shifts; the async-component default 200ms delay keeps it invisible on fast
// local loads (it only shows when the chunk genuinely takes its time).
const QueryEditorLoadingPlaceholder = () =>
  h("div", { class: "flex h-full w-full items-center justify-center text-muted-foreground" }, [
    h(Loader2, { class: "h-5 w-5 animate-spin" }),
  ]);

export const QueryEditor = defineAsyncComponent({
  loader: loadQueryEditorComponent,
  loadingComponent: QueryEditorLoadingPlaceholder,
});
