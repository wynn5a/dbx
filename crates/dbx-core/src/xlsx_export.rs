use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::io::{BufReader, BufWriter, Cursor, Write};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxWorksheetData {
    pub sheet_name: Option<String>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

fn escape_xml(value: &str) -> String {
    // Fast path: the overwhelmingly common case (plain text/number cells) has
    // nothing to escape or strip — scan first, then allocate only if needed.
    // The previous char-by-char flat_map allocated a Vec per character.
    let needs_work = value.chars().any(|ch| match ch {
        '&' | '<' | '>' | '"' => true,
        _ => {
            let code = ch as u32;
            !(code == 9 || code == 10 || code == 13 || code >= 32)
        }
    });
    if !needs_work {
        return value.to_string();
    }

    let mut out = String::with_capacity(value.len() + 16);
    for ch in value.chars() {
        let code = ch as u32;
        if !(code == 9 || code == 10 || code == 13 || code >= 32) {
            continue;
        }
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn column_name(index: usize) -> String {
    let mut out = String::new();
    let mut n = index + 1;
    while n > 0 {
        let rem = (n - 1) % 26;
        out.insert(0, (b'A' + rem as u8) as char);
        n = (n - 1) / 26;
    }
    out
}

fn cell_ref(row_index: usize, col_index: usize) -> String {
    format!("{}{}", column_name(col_index), row_index + 1)
}

fn sheet_range(column_count: usize, row_count: usize) -> String {
    if column_count == 0 || row_count == 0 {
        return "A1".to_string();
    }
    format!("A1:{}{}", column_name(column_count - 1), row_count)
}

fn normalize_sheet_name(input: Option<&str>) -> String {
    let base = input.unwrap_or("Sheet1");
    let name: String = base
        .chars()
        .map(|ch| match ch {
            '[' | ']' | ':' | '*' | '?' | '/' | '\\' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .to_string();
    let fallback = if name.is_empty() { "Sheet1" } else { &name };
    fallback.chars().take(31).collect()
}

fn value_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::Null) | None => String::new(),
        Some(Value::Bool(v)) => {
            if *v {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn estimate_column_widths(columns: &[String], rows: &[Vec<Value>]) -> Vec<usize> {
    columns
        .iter()
        .enumerate()
        .map(|(col_index, column)| {
            let values = rows.iter().take(100).map(|row| value_text(row.get(col_index)));
            let max_len = std::iter::once(column.clone())
                .chain(values)
                .map(|v| v.chars().count().min(60))
                .fold(8usize, usize::max);
            (max_len + 2).clamp(10, 60)
        })
        .collect()
}

fn cell_xml(value: Option<&Value>, row_index: usize, col_index: usize, style: Option<usize>) -> String {
    let reference = cell_ref(row_index, col_index);
    let style_attr = style.map_or(String::new(), |s| format!(" s=\"{s}\""));
    match value {
        Some(Value::Null) | None => format!("<c r=\"{reference}\"{style_attr}/>"),
        Some(Value::Bool(v)) => {
            let bool_v = if *v { 1 } else { 0 };
            format!("<c r=\"{reference}\" t=\"b\"{style_attr}><v>{bool_v}</v></c>")
        }
        Some(Value::Number(n)) => {
            if n.as_f64().is_some_and(|f| f.is_finite()) {
                format!("<c r=\"{reference}\"{style_attr}><v>{}</v></c>", n)
            } else {
                format!(
                    "<c r=\"{reference}\" t=\"inlineStr\"{style_attr}><is><t>{}</t></is></c>",
                    escape_xml(&n.to_string())
                )
            }
        }
        Some(Value::String(s)) => {
            format!("<c r=\"{reference}\" t=\"inlineStr\"{style_attr}><is><t>{}</t></is></c>", escape_xml(s))
        }
        Some(other) => format!(
            "<c r=\"{reference}\" t=\"inlineStr\"{style_attr}><is><t>{}</t></is></c>",
            escape_xml(&other.to_string())
        ),
    }
}

fn cols_xml(widths: &[usize]) -> String {
    widths
        .iter()
        .enumerate()
        .map(|(index, width)| {
            format!("<col min=\"{}\" max=\"{}\" width=\"{}\" customWidth=\"1\"/>", index + 1, index + 1, width)
        })
        .collect::<String>()
}

fn header_row_xml(columns: &[String]) -> String {
    format!(
        "<row r=\"1\">{}</row>",
        columns
            .iter()
            .enumerate()
            .map(|(index, col)| cell_xml(Some(&Value::String(col.clone())), 0, index, Some(1)))
            .collect::<String>()
    )
}

/// `<row>` XML for one zero-based data row (the header occupies Excel row 1,
/// so the first data row is Excel row 2). `columns` only fixes the cell count —
/// missing cells serialize as empty `<c/>`, exactly like the one-shot builder.
fn data_row_xml(columns: &[String], row: &[Value], row_index: usize) -> String {
    let excel_row = row_index + 2;
    let cells = columns
        .iter()
        .enumerate()
        .map(|(col_index, _)| cell_xml(row.get(col_index), excel_row - 1, col_index, None))
        .collect::<String>();
    format!("<row r=\"{excel_row}\">{cells}</row>")
}

/// Everything before `<sheetData>`: the XML declaration through `</cols>`.
/// `dimension`/`cols` depend on the full row count and sampled widths, which
/// are only known at finish time — the streaming writer emits this head last.
fn worksheet_head_xml(columns: &[String], widths: &[usize], data_row_count: usize) -> String {
    let range = sheet_range(columns.len(), data_row_count + 1);
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
            "<dimension ref=\"{range}\"/>",
            "<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>",
            "<sheetFormatPr defaultRowHeight=\"15\"/>",
            "<cols>{cols_xml}</cols>",
        ),
        range = range,
        cols_xml = cols_xml(widths),
    )
}

/// Everything after the last data row. The range matches the head's dimension.
fn worksheet_tail_xml(columns: &[String], data_row_count: usize) -> String {
    let range = sheet_range(columns.len(), data_row_count + 1);
    format!("<autoFilter ref=\"{range}\"/></worksheet>")
}

fn worksheet_xml(data: &XlsxWorksheetData) -> String {
    let widths = estimate_column_widths(&data.columns, &data.rows);
    let header_xml = header_row_xml(&data.columns);

    // Reserve up front so the sheet body grows without repeated reallocation:
    // each cell costs roughly the tag frame plus the value text.
    let mut body_xml = String::with_capacity(data.rows.len() * (data.columns.len() * 32 + 32) + header_xml.len() + 64);
    for (row_index, row) in data.rows.iter().enumerate() {
        body_xml.push_str(&data_row_xml(&data.columns, row, row_index));
    }

    format!(
        concat!("{head}", "<sheetData>{header_xml}{body_xml}</sheetData>", "{tail}",),
        head = worksheet_head_xml(&data.columns, &widths, data.rows.len()),
        header_xml = header_xml,
        body_xml = body_xml,
        tail = worksheet_tail_xml(&data.columns, data.rows.len()),
    )
}

fn content_types_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
        "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
        "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>",
        "</Types>"
    )
}

fn root_rels_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>",
        "</Relationships>"
    )
}

fn workbook_xml(sheet_name: &str) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
            "<sheets><sheet name=\"{}\" sheetId=\"1\" r:id=\"rId1\"/></sheets>",
            "</workbook>"
        ),
        escape_xml(sheet_name)
    )
}

fn workbook_rels_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>",
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
        "</Relationships>"
    )
}

fn styles_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>",
        "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>",
        "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>",
        "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>",
        "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs>",
        "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>",
        "</styleSheet>"
    )
}

pub fn build_xlsx_workbook(data: &XlsxWorksheetData) -> Result<Vec<u8>, String> {
    let sheet_name = normalize_sheet_name(data.sheet_name.as_deref());
    let files = vec![
        ("[Content_Types].xml", content_types_xml().to_string()),
        ("_rels/.rels", root_rels_xml().to_string()),
        ("xl/workbook.xml", workbook_xml(&sheet_name)),
        ("xl/_rels/workbook.xml.rels", workbook_rels_xml().to_string()),
        ("xl/styles.xml", styles_xml().to_string()),
        (SHEET_ENTRY_PATH, worksheet_xml(data)),
    ];

    let cursor = Cursor::new(Vec::<u8>::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    for (path, content) in files {
        zip.start_file(path, options).map_err(|err| err.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|err| err.to_string())?;
    }

    let output = zip.finish().map_err(|err| err.to_string())?;
    Ok(output.into_inner())
}

/// Sheet entry path inside the workbook zip. Shared by the one-shot builder
/// and the streaming writer so both produce the same archive layout.
const SHEET_ENTRY_PATH: &str = "xl/worksheets/sheet1.xml";

/// Sidecar file holding one page's worth of `<row>` XML at a time while the
/// rest of the workbook is being dimensioned. Same directory as the target
/// (same filesystem, safe to clean up), removed on finish or on drop.
fn sheet_sidecar_path(target_path: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(format!("{target_path}.xlsx-rows.part"))
}

/// Streaming XLSX worksheet writer.
///
/// The one-shot `build_xlsx_workbook` accumulates every exported row in memory
/// (`table_export` used to hold all pages in `all_rows`) and materializes the
/// whole sheet XML as one `String`. This writer instead appends each page's
/// rows to a sidecar file next to the target as they arrive, so peak memory
/// stays O(page) no matter how large the export is:
///
/// ```text
/// write_rows() ─▶ `<target>.xlsx-rows.part` (raw `<row>` XML, O(page) RAM)
/// finish()     ─▶ head + `<sheetData>` + header + sidecar + tail, zipped
/// ```
///
/// Dropping the writer without `finish()` (cancel / error) leaves the target
/// untouched and removes the sidecar, so a cancelled export never produces a
/// corrupt workbook. Column widths keep sampling the first 100 rows exactly
/// like `estimate_column_widths`, and the finished archive is byte-identical
/// to the one-shot builder for the same rows.
pub struct XlsxSheetStreamWriter {
    sidecar_path: std::path::PathBuf,
    sidecar: Option<BufWriter<File>>,
    columns: Vec<String>,
    widths: Vec<usize>,
    sampled_rows: usize,
    data_rows: usize,
    finished: bool,
}

/// Width sampling mirrors `estimate_column_widths` (first 100 rows).
const WIDTH_SAMPLE_ROWS: usize = 100;

impl XlsxSheetStreamWriter {
    /// Creates the sidecar next to `target_path`. The target itself is not
    /// touched until `finish()`, so constructing the writer is side-effect
    /// free from the user's point of view.
    pub fn create(target_path: &str, columns: &[String]) -> Result<Self, String> {
        let sidecar_path = sheet_sidecar_path(target_path);
        let file = File::create(&sidecar_path).map_err(|err| format!("Failed to create XLSX scratch file: {err}"))?;
        Ok(Self {
            sidecar_path,
            sidecar: Some(BufWriter::new(file)),
            widths: columns.iter().map(|column| column_width_for(column)).collect(),
            columns: columns.to_vec(),
            sampled_rows: 0,
            data_rows: 0,
            finished: false,
        })
    }

    /// Appends one page of rows to the sidecar, one `<row>` per line.
    pub fn write_rows(&mut self, rows: &[Vec<Value>]) -> Result<(), String> {
        let writer = self.sidecar.as_mut().ok_or("XLSX sheet writer already finished")?;
        // Scratch stays bounded (~1 MiB) even for pathological wide rows.
        let mut scratch = String::with_capacity((rows.len() * (self.columns.len() * 32 + 32)).min(1 << 20) + 64);
        for row in rows {
            if self.sampled_rows < WIDTH_SAMPLE_ROWS {
                for (col_index, width) in self.widths.iter_mut().enumerate() {
                    *width = (*width).max(column_width_for(&value_text(row.get(col_index))));
                }
                self.sampled_rows += 1;
            }
            scratch.push_str(&data_row_xml(&self.columns, row, self.data_rows));
            self.data_rows += 1;
            if scratch.len() >= 1 << 20 {
                writer
                    .write_all(scratch.as_bytes())
                    .map_err(|err| format!("Failed to write XLSX scratch file: {err}"))?;
                scratch.clear();
            }
        }
        if !scratch.is_empty() {
            writer.write_all(scratch.as_bytes()).map_err(|err| format!("Failed to write XLSX scratch file: {err}"))?;
        }
        Ok(())
    }

    /// Assembles the workbook at `target_path` and removes the sidecar.
    /// A failed assembly also removes a partially written target, so callers
    /// never leave a corrupt `.xlsx` behind.
    pub fn finish(mut self, target_path: &str, sheet_name: Option<&str>) -> Result<(), String> {
        // Flush + close the sidecar before reading it back (Windows locks).
        if let Some(mut sidecar) = self.sidecar.take() {
            sidecar.flush().map_err(|err| format!("Failed to write XLSX scratch file: {err}"))?;
        }
        drop(self.sidecar.take());
        let result = assemble_streamed_workbook(
            target_path,
            sheet_name,
            &self.columns,
            &self.widths,
            self.data_rows,
            &self.sidecar_path,
        );
        // The sidecar is scratch state: always clean it up, success or not.
        let _ = std::fs::remove_file(&self.sidecar_path);
        self.finished = true;
        if result.is_err() {
            let _ = std::fs::remove_file(target_path);
        }
        result
    }
}

impl Drop for XlsxSheetStreamWriter {
    fn drop(&mut self) {
        if !self.finished {
            drop(self.sidecar.take());
            let _ = std::fs::remove_file(&self.sidecar_path);
        }
    }
}

/// Single sampled width, mirroring one step of `estimate_column_widths`'s
/// `(chars capped at 60, floor 8, +2 padding, clamp 10..=60)` rule.
fn column_width_for(text: &str) -> usize {
    (text.chars().count().clamp(8, 60) + 2).clamp(10, 60)
}

fn assemble_streamed_workbook(
    target_path: &str,
    sheet_name: Option<&str>,
    columns: &[String],
    widths: &[usize],
    data_row_count: usize,
    sidecar_path: &std::path::Path,
) -> Result<(), String> {
    let sheet_name = normalize_sheet_name(sheet_name);
    let target = File::create(target_path).map_err(|err| format!("Failed to create XLSX file: {err}"))?;
    let mut zip = zip::ZipWriter::new(BufWriter::new(target));
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    for (path, content) in [
        ("[Content_Types].xml", content_types_xml().to_string()),
        ("_rels/.rels", root_rels_xml().to_string()),
        ("xl/workbook.xml", workbook_xml(&sheet_name)),
        ("xl/_rels/workbook.xml.rels", workbook_rels_xml().to_string()),
        ("xl/styles.xml", styles_xml().to_string()),
    ] {
        zip.start_file(path, options).map_err(|err| err.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|err| err.to_string())?;
    }

    zip.start_file(SHEET_ENTRY_PATH, options).map_err(|err| err.to_string())?;
    zip.write_all(worksheet_head_xml(columns, widths, data_row_count).as_bytes()).map_err(|err| err.to_string())?;
    zip.write_all(b"<sheetData>").map_err(|err| err.to_string())?;
    zip.write_all(header_row_xml(columns).as_bytes()).map_err(|err| err.to_string())?;
    let mut sidecar =
        BufReader::new(File::open(sidecar_path).map_err(|err| format!("Failed to read XLSX scratch file: {err}"))?);
    std::io::copy(&mut sidecar, &mut zip).map_err(|err| err.to_string())?;
    zip.write_all(b"</sheetData>").map_err(|err| err.to_string())?;
    zip.write_all(worksheet_tail_xml(columns, data_row_count).as_bytes()).map_err(|err| err.to_string())?;

    let mut buffered = zip.finish().map_err(|err| err.to_string())?;
    buffered.flush().map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_xlsx_workbook, escape_xml, XlsxSheetStreamWriter, XlsxWorksheetData};
    use serde_json::json;

    /// Writes `rows` in `page_size` chunks through the streaming writer and
    /// returns the finished workbook bytes. Fails the test on any error.
    fn streamed_workbook(columns: &[String], rows: &[Vec<serde_json::Value>], page_size: usize) -> Vec<u8> {
        let dir = std::env::temp_dir().join(format!("dbx-xlsx-stream-test-{}-{page_size}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let target = dir.join(format!("out-{page_size}.xlsx"));
        let target_str = target.to_str().expect("scratch path is UTF-8").to_string();

        let mut writer = XlsxSheetStreamWriter::create(&target_str, columns).expect("create stream writer");
        for chunk in rows.chunks(page_size.max(1)) {
            writer.write_rows(chunk).expect("write rows");
        }
        writer.finish(&target_str, Some("streamed")).expect("finish workbook");

        // Scratch is cleaned up; the target is a valid zip.
        assert!(!std::path::Path::new(&format!("{target_str}.xlsx-rows.part")).exists());
        let bytes = std::fs::read(&target).expect("read finished workbook");
        std::fs::remove_dir_all(&dir).ok();
        bytes
    }

    #[test]
    fn escapes_and_strips_like_the_reference_implementation() {
        // All five observable behaviors of the original char-by-char version:
        // entity escaping, control-char stripping, and tab/newline carriage
        // return preservation — for both the fast path and the rewrite path.
        assert_eq!(escape_xml("plain text"), "plain text");
        assert_eq!(escape_xml("a&b<c>d\"e"), "a&amp;b&lt;c&gt;d&quot;e");
        assert_eq!(escape_xml("tab\tkept"), "tab\tkept");
        assert_eq!(escape_xml("nl\nkept"), "nl\nkept");
        assert_eq!(escape_xml("cr\rkept"), "cr\rkept");
        assert_eq!(escape_xml("ctrl\u{0001}\u{001f}stripped"), "ctrlstripped");
        assert_eq!(escape_xml("unicode保持 ✓"), "unicode保持 ✓");
    }

    #[test]
    fn builds_xlsx_zip_with_sheet_data() {
        let workbook = build_xlsx_workbook(&XlsxWorksheetData {
            sheet_name: Some("Users".to_string()),
            columns: vec!["id".to_string(), "name".to_string(), "active".to_string()],
            rows: vec![vec![json!(1), json!("Ada & Bob"), json!(true)], vec![json!(2), json!(null), json!(false)]],
        })
        .expect("build workbook");
        let text = String::from_utf8_lossy(&workbook);

        assert_eq!(workbook[0], 0x50);
        assert_eq!(workbook[1], 0x4b);
        assert!(text.contains("[Content_Types].xml"));
        assert!(text.contains("xl/worksheets/sheet1.xml"));
        assert!(text.contains("name=\"Users\""));
        assert!(text.contains("<c r=\"A2\"><v>1</v></c>"));
        assert!(text.contains("Ada &amp; Bob"));
        assert!(text.contains("<c r=\"C2\" t=\"b\"><v>1</v></c>"));
    }

    #[test]
    fn sanitizes_invalid_sheet_name() {
        let workbook = build_xlsx_workbook(&XlsxWorksheetData {
            sheet_name: Some("bad/name:with*chars?and-a-very-long-tail".to_string()),
            columns: vec!["value".to_string()],
            rows: vec![vec![json!("ok")]],
        })
        .expect("build workbook");
        let text = String::from_utf8_lossy(&workbook);
        assert!(text.contains("name=\"bad name with chars and-a-very-\""));
    }

    fn sample_columns() -> Vec<String> {
        vec!["id".to_string(), "name".to_string(), "active".to_string(), "note".to_string()]
    }

    fn sample_rows(count: usize) -> Vec<Vec<serde_json::Value>> {
        (0..count)
            .map(|i| {
                vec![
                    json!(i),
                    json!(format!("user-{i} <&> \"quoted\"")),
                    json!(i % 2 == 0),
                    if i % 7 == 0 { serde_json::Value::Null } else { json!(format!("note {i}")) },
                ]
            })
            .collect()
    }

    fn one_shot_workbook(rows: &[Vec<serde_json::Value>]) -> Vec<u8> {
        build_xlsx_workbook(&XlsxWorksheetData {
            sheet_name: Some("streamed".to_string()),
            columns: sample_columns(),
            rows: rows.to_vec(),
        })
        .expect("build workbook")
    }

    #[test]
    fn streamed_workbook_matches_one_shot_bytes() {
        // >100 rows so column widths must sample the first 100 (not just the
        // header), mixed types, escaping, and NULLs included.
        let rows = sample_rows(250);
        let expected = one_shot_workbook(&rows);
        for page_size in [1, 7, 1000] {
            assert_eq!(
                streamed_workbook(&sample_columns(), &rows, page_size),
                expected,
                "page_size={page_size} must produce identical bytes"
            );
        }
    }

    #[test]
    fn streamed_empty_table_matches_one_shot() {
        let expected = one_shot_workbook(&[]);
        assert_eq!(streamed_workbook(&sample_columns(), &[], 10), expected);
        let text = String::from_utf8_lossy(&expected);
        assert!(text.contains("<dimension ref=\"A1:D1\"/>"));
    }

    #[test]
    fn dropped_writer_leaves_no_target_and_cleans_sidecar() {
        let dir = std::env::temp_dir().join(format!("dbx-xlsx-drop-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let target = dir.join("cancelled.xlsx");
        let target_str = target.to_str().expect("scratch path is UTF-8").to_string();

        {
            let mut writer =
                XlsxSheetStreamWriter::create(&target_str, &sample_columns()).expect("create stream writer");
            writer.write_rows(&sample_rows(50)).expect("write rows");
            // Drop without finish(): simulates export cancellation.
        }

        assert!(!target.exists(), "cancelled export must not create the target");
        assert!(
            !std::path::Path::new(&format!("{target_str}.xlsx-rows.part")).exists(),
            "cancelled export must clean the sidecar"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
