import { ref } from "vue";
import { useTheme } from "@/composables/useTheme";
import { type SqlHighlighter, createShikiSqlHighlighter } from "@/lib/sqlHighlighter";

export function useSqlHighlighter() {
  const { isDark } = useTheme();
  const sqlHighlighter = ref<SqlHighlighter>();
  let loadStarted = false;

  // Shiki (plus the SQL grammar and both themes) is a sizable chunk, so only
  // fetch it the first time actual SQL is highlighted. Callers render plain
  // text until the promise resolves, then re-render via the ref.
  function ensureHighlighter() {
    if (loadStarted) return;
    loadStarted = true;
    createShikiSqlHighlighter({ appearance: () => (isDark.value ? "dark" : "light") })
      .then((highlighter) => {
        sqlHighlighter.value = highlighter;
      })
      .catch((err) => {
        // Allow a retry on the next highlight call instead of staying plain forever.
        loadStarted = false;
        console.warn("[useSqlHighlighter] failed to load shiki:", err);
      });
  }

  function highlight(sql: string): string {
    if (!sql) return sql;
    ensureHighlighter();
    return sqlHighlighter.value?.(sql) ?? sql;
  }

  return { highlight, sqlHighlighter };
}
