// A fast drop-in replacement for csv-reader 1.0.0's readCsv, for make.fun's
// csv-reader-speed-01. It returns exactly the answer csv-reader 1.0.0 returns
// for every input ({columns, rows, errors} under the same broken-row policy),
// but reads the text with index jumps and whole-field slices instead of one
// character at a time: a field's value is cut out of the text in one slice
// whenever the field holds no character that needs rewriting, and only the
// rare fields that do (a stray CR in an unquoted field, a CR inside a quoted
// field) fall back to a segment-by-segment build.
//
// The policy, identical to csv-reader 1.0.0's:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote, and each CRLF or lone CR inside it
//     read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character, and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted),
//     row its record's index in rows (null for the header), in the order
//     met.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next.

// How a field ended: at a comma, at a line break, or at the end of the text.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = typeof input.text === 'string' ? input.text : String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The field just read: its value, how it ended, and how many characters
  // the read appended to the value it started from.
  let fv = '';
  let fe = END;
  let fa = 0;

  // A cursor over the text's CRs: crNext is the first CR at or after
  // crMark, or -1 when there is none. Reads move forward, so each CR is
  // found once; the one backward jump (a quote that never closes) resets
  // the cursor where it lands.
  let crMark = 0;
  let crNext = text.indexOf('\r', 0);

  // The first CR at or after `from`, or -1.
  function firstCr(from) {
    if (crNext === -1 || crNext >= from) return crNext;
    crNext = text.indexOf('\r', from);
    crMark = from;
    return crNext;
  }

  // Reads an unquoted field starting at pos, appending to `prefix` ('' for a
  // plain field, the quoted part for what follows a closing quote, '"' for a
  // quote that never closed). Sets fv, fe, fa.
  function readUnquoted(prefix) {
    const start = pos;
    // The field runs to the first comma or LF (index jumps, not a scan).
    const comma = text.indexOf(',', start);
    const nl = text.indexOf('\n', start);
    let end;
    let ended;
    if (comma === -1 && nl === -1) {
      end = n;
      ended = END;
    } else if (nl === -1 || (comma !== -1 && comma < nl)) {
      end = comma;
      ended = COMMA;
    } else {
      end = nl;
      ended = LINE_BREAK;
    }
    const cr = firstCr(start);
    if (cr === -1 || cr >= end) {
      // No CR inside the field: one slice is the whole value.
      fv = prefix + text.slice(start, end);
      fa = end - start;
      fe = ended;
      pos = ended === END ? n : end + 1;
      if (ended === LINE_BREAK) line += 1;
      return;
    }
    if (cr === end - 1 && ended === LINE_BREAK) {
      // The CR of the closing CRLF: the value stops before it.
      fv = prefix + text.slice(start, end - 1);
      fa = end - 1 - start;
      fe = LINE_BREAK;
      pos = end + 1;
      line += 1;
      return;
    }
    // A stray CR inside the field: the segment build below drops it.
    const parts = [prefix];
    let added = 0;
    let seg = pos;
    let j = pos;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === 44) {
        parts.push(text.slice(seg, j));
        added += j - seg;
        fv = parts.join('');
        fa = added;
        fe = COMMA;
        pos = j + 1;
        return;
      }
      if (c === 10) {
        parts.push(text.slice(seg, j));
        added += j - seg;
        fv = parts.join('');
        fa = added;
        fe = LINE_BREAK;
        pos = j + 1;
        line += 1;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(j + 1) === 10) {
          parts.push(text.slice(seg, j));
          added += j - seg;
          fv = parts.join('');
          fa = added;
          fe = LINE_BREAK;
          pos = j + 2;
          line += 1;
          return;
        }
        error('stray_cr');
        parts.push(text.slice(seg, j));
        added += j - seg;
        j += 1;
        seg = j;
        continue;
      }
      j += 1;
    }
    parts.push(text.slice(seg, n));
    added += n - seg;
    fv = parts.join('');
    fa = added;
    fe = END;
    pos = n;
  }

  // What follows a quoted field's closing quote: END, COMMA or LINE_BREAK,
  // or the junk read that appends to fv. `close` is the closing quote's
  // index; fv already holds the quoted value.
  function afterQuoted(close) {
    pos = close + 1;
    if (pos >= n) {
      fe = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fe = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fe = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fe = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands.
    readUnquoted(fv);
    if (fa > 0) error('quote_junk');
  }

  // A quoted field whose content holds a CR: the segment build, one slice
  // per run between the characters that change (a doubled quote, a CR or
  // CRLF read as LF). Mirrors the reference read char for char.
  function readQuotedSlow(open, openLine) {
    const parts = [];
    let seg = open + 1;
    let j = seg;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === 34) {
        if (text.charCodeAt(j + 1) === 34) {
          parts.push(text.slice(seg, j), '"');
          j += 2;
          seg = j;
          continue;
        }
        parts.push(text.slice(seg, j));
        fv = parts.join('');
        afterQuoted(j);
        return;
      }
      if (c === 13) {
        parts.push(text.slice(seg, j), '\n');
        line += 1;
        j += text.charCodeAt(j + 1) === 10 ? 2 : 1;
        seg = j;
        continue;
      }
      if (c === 10) line += 1;
      j += 1;
    }
    // The quote never closes: it is a literal character, and the text after
    // it is read again as unquoted.
    pos = open + 1;
    line = openLine;
    crMark = pos;
    crNext = text.indexOf('\r', pos);
    error('unterminated_quote');
    readUnquoted('"');
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv, fe.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: a quote that is not doubled.
    let i = open + 1;
    let close = -1;
    while (true) {
      const q = text.indexOf('"', i);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        i = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      pos = open + 1;
      line = openLine;
      crMark = pos;
      crNext = text.indexOf('\r', pos);
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    // A CR in the content sends the field to the segment build (a CR is
    // read as LF inside quotes); without one, the content's LFs are counted
    // with index jumps.
    const cr = firstCr(open + 1);
    if (cr !== -1 && cr < close) {
      readQuotedSlow(open, openLine);
      return;
    }
    let lf = 0;
    for (let j = text.indexOf('\n', open + 1); j !== -1 && j < close; j = text.indexOf('\n', j + 1)) lf += 1;
    line += lf;
    // No doubled quote was skipped on the way to the closing quote exactly
    // when the search never advanced: then the content holds no quote.
    fv =
      i === open + 1
        ? text.slice(open + 1, close)
        : text.slice(open + 1, close).replaceAll('""', '"');
    afterQuoted(close);
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
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fv);
    } while (fe === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
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
