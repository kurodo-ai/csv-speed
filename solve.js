// A fast drop-in replacement for csv-reader 1.0.0: run(input) returns exactly the answer csv-reader
// returns for {text, header} — {columns, rows, errors} — under csv-reader's written broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote,
//     and each CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma
//     or line break, is appended as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed;
//   - columns is the first record when header is true, else null; rows holds the records after it (every
//     record when header is false), each padded with "" (short_row, with fields: its count) or cut
//     (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone
//     CR inside a quoted field counted), row its record's index in rows (null for the header), in the
//     order met, a field's quote_junk when the field ends, a record's short_row or long_row at its end.
//
// Where csv-reader walks one character at a time, this reader jumps between the characters that matter
// (comma, quote, CR, LF) with indexOf and takes whole field segments with slice, falling back to a
// segment-by-segment build only where a stray CR or a doubled quote splits a field. The reading order,
// the error order and every value are csv-reader's own.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The field just read by readUnquoted or readQuoted: its value, how it ended, and (for readUnquoted)
  // how many characters it kept — the count quote_junk is judged by.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is
  // dropped (stray_cr). Sets fValue, fEnded and fAdded.
  function readUnquoted(value) {
    // First try: the field ends at the next comma or LF (or at the end of the text), and no CR sits in
    // between but the line break's own — the whole field is then one slice.
    const ic = text.indexOf(',', pos);
    const il = text.indexOf('\n', pos);
    let m = n;
    let mc = END;
    if (ic !== -1) { m = ic; mc = COMMA; }
    if (il !== -1 && il < m) { m = il; mc = LINE_BREAK; }
    let candEnd = m;
    if (mc === LINE_BREAK && candEnd > pos && text.charCodeAt(candEnd - 1) === 13) candEnd -= 1;
    const ir0 = text.indexOf('\r', pos);
    if (ir0 === -1 || ir0 >= candEnd) {
      fValue = candEnd > pos ? value + text.slice(pos, candEnd) : value;
      fAdded = candEnd - pos;
      fEnded = mc;
      if (mc === COMMA) pos = m + 1;
      else if (mc === LINE_BREAK) { pos = m + 1; line += 1; }
      else pos = n;
      return;
    }
    // A CR sits inside the field: walk it segment by segment, dropping each stray CR.
    let added = 0;
    let parts = null; // segments of the value past `value`, once a stray CR splits the field
    let seg = pos; // the start of the clean segment not yet taken
    while (pos < n) {
      const jc = text.indexOf(',', pos);
      const jl = text.indexOf('\n', pos);
      const jr = text.indexOf('\r', pos);
      let j = n;
      let kc = -1;
      if (jc !== -1 && jc < j) { j = jc; kc = 44; }
      if (jl !== -1 && jl < j) { j = jl; kc = 10; }
      if (jr !== -1 && jr < j) { j = jr; kc = 13; }
      if (kc === -1) { pos = n; break; }
      if (kc === 13 && !(j + 1 < n && text.charCodeAt(j + 1) === 10)) {
        // A stray CR: take the segment before it, drop the CR, read on.
        if (j > seg) {
          if (parts === null) parts = [];
          parts.push(text.slice(seg, j));
          added += j - seg;
        }
        error('stray_cr');
        pos = j + 1;
        seg = pos;
        continue;
      }
      // A comma, an LF or a CRLF ends the field: take the last segment and stop.
      if (j > seg) {
        if (parts === null) value += text.slice(seg, j);
        else parts.push(text.slice(seg, j));
        added += j - seg;
      }
      if (parts !== null) value += parts.join('');
      fValue = value;
      fAdded = added;
      if (kc === 44) {
        pos = j + 1;
        fEnded = COMMA;
      } else {
        pos = j + (kc === 13 ? 2 : 1);
        line += 1;
        fEnded = LINE_BREAK;
      }
      return;
    }
    // The end of the text ends the field.
    if (n > seg) {
      if (parts === null) value += text.slice(seg, n);
      else parts.push(text.slice(seg, n));
      added += n - seg;
    }
    if (parts !== null) value += parts.join('');
    fValue = value;
    fAdded = added;
    fEnded = END;
  }

  // Takes the quoted segment text[seg..end) onto `parts` (an array) or returns it whole when it is one
  // clean slice: counts the lines it spans onto `line` and reads each CRLF or lone CR in it as one LF.
  function takeQuotedSegment(seg, end, parts) {
    if (end <= seg) return;
    const slice = text.slice(seg, end);
    if (slice.indexOf('\n') === -1 && slice.indexOf('\r') === -1) {
      parts.push(slice);
      return;
    }
    // The segment spans lines: count them and rebuild it with every break read as LF.
    let li = 0;
    for (let i = slice.indexOf('\n'); i !== -1; i = slice.indexOf('\n', i + 1)) li += 1;
    for (let i = slice.indexOf('\r'); i !== -1; i = slice.indexOf('\r', i + 1)) {
      li += 1;
      if (slice.charCodeAt(i + 1) === 10) li -= 1; // a CRLF is one break, counted at its CR
    }
    line += li;
    parts.push(slice.replace(/\r\n|\r/g, '\n'));
  }

  // Ends a quoted field whose value is read and whose closing quote is consumed: the character after
  // the quote decides — a comma, a line break, the end of the text, or junk appended as it stands.
  function endQuoted(value) {
    fValue = value;
    if (pos >= n) {
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue and fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    const parts = [];
    let seg = pos; // the start of the segment not yet taken
    let closed = false;
    while (pos < n) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        pos = n;
        break;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote, and the field goes on.
        takeQuotedSegment(seg, q, parts);
        parts.push('"');
        pos = q + 2;
        seg = pos;
        continue;
      }
      takeQuotedSegment(seg, q, parts);
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    endQuoted(parts.length === 1 ? parts[0] : parts.join(''));
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let quoted = false;

    // Fast path: a record whose own line holds no quote and no CR but its line break's own is a plain
    // split on commas — no field of it can be quoted, span lines or drop a stray CR, and it makes no
    // errors. The two probes stop at the line's content end; a quote or a CR inside it sends the record
    // to the general reader below, which re-reads it from its start.
    {
      let lineEnd = text.indexOf('\n', pos);
      const hasEol = lineEnd !== -1;
      if (!hasEol) lineEnd = n;
      let contentEnd = lineEnd;
      if (hasEol && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
      const iq = text.indexOf('"', pos);
      const ir = text.indexOf('\r', pos);
      if (contentEnd > pos && (iq === -1 || iq >= contentEnd) && (ir === -1 || ir >= contentEnd)) {
        fields = [];
        let fstart = pos;
        for (;;) {
          const c = text.indexOf(',', fstart);
          if (c === -1 || c >= contentEnd) {
            fields.push(text.slice(fstart, contentEnd));
            break;
          }
          fields.push(text.slice(fstart, c));
          fstart = c + 1;
        }
        pos = hasEol ? lineEnd + 1 : n;
        if (hasEol) line += 1;
      }
    }

    if (fields === null) {
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted();
        else readUnquoted('');
        fields.push(fValue);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
