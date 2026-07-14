#!/usr/bin/env python3
"""Convert a Markdown document to a tufte-handout LaTeX file.

Matches the typographic style of the Axona Explainer / Applications docs:
custom Axona title page + epigraph-free body, serif Tufte measure with
margin space, booktabs tables, listings code blocks, foot page numbers.

Usage:
    python3 _md_to_tufte.py <input.md> <output.tex> \
        --title "Axona API Reference" \
        --subtitle "Every public symbol in @axona/protocol v2.10.0" \
        --version "@axona/protocol v2.10.0 · 2026-06-01"

The emitted .tex compiles with:  tectonic -X compile <output.tex>

Scope: the Markdown subset these docs actually use — ATX headings (#..####),
fenced code blocks (```lang), pipe tables, ordered/unordered (nested) lists,
blockquotes, horizontal rules, and inline **bold** / *em* / `code` / [t](url).
Headings are rendered UNNUMBERED because these docs carry their own numbering
in the heading text ("### 1. Identity", "§17"), which we must not double up.
"""

import re
import sys

# ── argument parsing ────────────────────────────────────────────────────────
if len(sys.argv) < 3:
    sys.exit("usage: _md_to_tufte.py <input.md> <output.tex> "
             "[--title T] [--subtitle S] [--version V]")
INPUT, OUTPUT = sys.argv[1], sys.argv[2]
TITLE = SUBTITLE = VERSION = None
i = 3
while i < len(sys.argv):
    a = sys.argv[i]
    if a == '--title':    TITLE = sys.argv[i + 1]; i += 2
    elif a == '--subtitle': SUBTITLE = sys.argv[i + 1]; i += 2
    elif a == '--version':  VERSION = sys.argv[i + 1]; i += 2
    else: i += 1

# ── LaTeX escaping ──────────────────────────────────────────────────────────
def esc_text(s):
    """Escape LaTeX specials in ordinary prose."""
    s = s.replace('\\', '\\textbackslash{}')
    for ch, rep in (('&', '\\&'), ('%', '\\%'), ('$', '\\$'), ('#', '\\#'),
                    ('_', '\\_'), ('{', '\\{'), ('}', '\\}')):
        s = s.replace(ch, rep)
    s = s.replace('~', '\\textasciitilde{}').replace('^', '\\textasciicircum{}')
    return s

def esc_code(s):
    """Escape for \\texttt{} content (inline code)."""
    s = s.replace('\\', '\\textbackslash{}')
    s = s.replace('{', '\\{').replace('}', '\\}')
    for ch, rep in (('#', '\\#'), ('$', '\\$'), ('%', '\\%'), ('&', '\\&'),
                    ('_', '\\_')):
        s = s.replace(ch, rep)
    s = s.replace('~', '\\textasciitilde{}').replace('^', '\\textasciicircum{}')
    s = s.replace('<', '\\textless{}').replace('>', '\\textgreater{}')
    return s

def esc_url(u):
    return u.replace('%', '\\%').replace('#', '\\#')

# ASCII-fold non-ASCII inside code blocks (verbatim → no LaTeX/listings unicode pain)
CODE_FOLD = {
    '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≈': '~=', '∼': '~',
    '×': 'x', '…': '...', '✓': '[x]', '⌈': 'ceil(', '⌉': ')', '•': '*',
    '≠': '!=', '·': '.', '∞': 'inf', '≜': ':=', '⊕': '(+)', '′': "'",
    '’': "'", '‘': "'", '“': '"', '”': '"', '—': '---', '–': '--',
    '§': 'section ', '⇒': '=>', '∈': ' in ', '¼': '1/4', '⚠': '(!)',
    '▼': 'v', '►': '>', '️': '',
    '─': '-', '│': '|', '├': '+', '┌': '+', '┬': '+', '┐': '+',
    '└': '+', '┴': '+', '┘': '+',
    ' ': ' ', ' ': ' ', ' ': ' ',
}
_CODE_FOLD_RE = re.compile('|'.join(re.escape(k) for k in CODE_FOLD))
def code_ascii(s):
    return _CODE_FOLD_RE.sub(lambda m: CODE_FOLD[m.group(0)], s)

# ── inline formatting ───────────────────────────────────────────────────────
CODE_RE = re.compile(r'`([^`]+)`')
LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
BOLD_RE = re.compile(r'\*\*([^*]+)\*\*')
EM_RE   = re.compile(r'(?<!\*)\*([^*]+)\*(?!\*)')
EMU_RE  = re.compile(r'(?<![\w\\])_([^_]+)_(?![\w])')

def inline(s):
    """Convert a span of inline Markdown to LaTeX, code-span-safe."""
    out = []
    pos = 0
    for m in CODE_RE.finditer(s):
        out.append(_inline_nocode(s[pos:m.start()]))
        out.append('\\texttt{' + esc_code(m.group(1)) + '}')
        pos = m.end()
    out.append(_inline_nocode(s[pos:]))
    return ''.join(out)

def _inline_nocode(s):
    # links first (so their text isn't escaped as URL); use placeholders
    links = []
    def _link(m):
        links.append((m.group(1), m.group(2)))
        return '\x00%d\x00' % (len(links) - 1)
    s = LINK_RE.sub(_link, s)
    # bold / em over placeholder-protected text
    s = BOLD_RE.sub(lambda m: '\x01' + m.group(1) + '\x02', s)
    s = EM_RE.sub(lambda m: '\x03' + m.group(1) + '\x04', s)
    s = EMU_RE.sub(lambda m: '\x03' + m.group(1) + '\x04', s)
    # escape the literal text, then restore markup
    s = esc_text(s)
    s = s.replace('\x01', '\\textbf{').replace('\x02', '}')
    s = s.replace('\x03', '\\emph{').replace('\x04', '}')
    def _restore(m):
        text, url = links[int(m.group(1))]
        return '\\href{' + esc_url(url) + '}{' + inline(text) + '}'
    s = re.sub('\x00(\\d+)\x00', _restore, s)
    return s

# ── block parsing ───────────────────────────────────────────────────────────
def heading_clean(text):
    return re.sub(r'\s*\{#[^}]*\}\s*$', '', text).strip()

def main():
    raw = open(INPUT, encoding='utf-8').read().split('\n')
    title = TITLE
    body = []
    i = 0
    # capture/strip the first H1 as the title
    while i < len(raw):
        if raw[i].startswith('# '):
            if not title:
                title = heading_clean(raw[i][2:])
            i += 1
            break
        if raw[i].strip() == '':
            i += 1; continue
        break
    body = raw[i:]

    out = []
    n = len(body)
    i = 0
    list_stack = []  # list of ('itemize'|'enumerate', indent)

    def close_lists(to_indent=-1):
        while list_stack and list_stack[-1][1] > to_indent:
            kind, _ = list_stack.pop()
            out.append('\\end{%s}' % kind)

    while i < n:
        line = body[i]
        stripped = line.strip()

        # fenced code block
        m = re.match(r'^```(\w*)\s*$', line)
        if m:
            close_lists()
            code = []
            i += 1
            while i < n and not re.match(r'^```\s*$', body[i]):
                code.append(body[i]); i += 1
            i += 1  # skip closing fence
            out.append('\\begin{lstlisting}')
            out.extend(code_ascii(c) for c in code)
            out.append('\\end{lstlisting}')
            continue

        # table: a header row followed by a |---|---| separator
        if stripped.startswith('|') and i + 1 < n and re.match(
                r'^\s*\|?[\s:|-]+\|[\s:|-]*$', body[i + 1]) and '-' in body[i + 1]:
            close_lists()
            header = split_row(body[i])
            sep = split_row(body[i + 1])
            i += 2
            rows = []
            while i < n and body[i].strip().startswith('|'):
                rows.append(split_row(body[i])); i += 1
            emit_table(out, header, sep, rows)
            continue

        # horizontal rule
        if re.match(r'^(\*\s*){3,}$', stripped) or re.match(r'^(-\s*){3,}$', stripped) \
                or re.match(r'^(_\s*){3,}$', stripped):
            close_lists()
            out.append('\\par\\medskip\\noindent\\rule{\\linewidth}{0.2pt}\\par\\medskip')
            i += 1; continue

        # headings
        hm = re.match(r'^(#{2,6})\s+(.*)$', line)
        if hm:
            close_lists()
            level = len(hm.group(1))
            text = inline(heading_clean(hm.group(2)))
            if level == 2:
                out.append('\\section*{%s}' % text)
            elif level == 3:
                out.append('\\subsection*{%s}' % text)
            else:
                out.append('\\apihead{%s}' % text)
            i += 1; continue

        # blockquote
        if stripped.startswith('>'):
            close_lists()
            quote = []
            while i < n and body[i].strip().startswith('>'):
                quote.append(re.sub(r'^\s*>\s?', '', body[i])); i += 1
            out.append('\\begin{quote}')
            out.append(inline(' '.join(q for q in quote if q.strip())))
            out.append('\\end{quote}')
            continue

        # list item (ordered or unordered), with indent for nesting
        lm = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', line)
        if lm:
            indent = len(lm.group(1))
            kind = 'enumerate' if lm.group(2)[0].isdigit() else 'itemize'
            # open/adjust nesting
            if not list_stack or indent > list_stack[-1][1]:
                out.append('\\begin{%s}' % kind)
                list_stack.append((kind, indent))
            else:
                close_lists(indent)
                if not list_stack or list_stack[-1][1] < indent:
                    out.append('\\begin{%s}' % kind)
                    list_stack.append((kind, indent))
            item_text = lm.group(3)
            # gather wrapped continuation lines
            j = i + 1
            while j < n and body[j].strip() and not re.match(
                    r'^(\s*)([-*]|\d+\.)\s+', body[j]) and not body[j].startswith('#') \
                    and not body[j].strip().startswith('|') \
                    and not re.match(r'^```', body[j]):
                item_text += ' ' + body[j].strip(); j += 1
            out.append('\\item ' + inline(item_text))
            i = j; continue

        # blank line
        if stripped == '':
            close_lists()
            out.append('')
            i += 1; continue

        # plain paragraph (gather until blank/structural)
        close_lists()
        para = [line]
        j = i + 1
        while j < n and body[j].strip() and not body[j].startswith('#') \
                and not body[j].strip().startswith('|') \
                and not re.match(r'^```', body[j]) \
                and not re.match(r'^(\s*)([-*]|\d+\.)\s+', body[j]) \
                and not body[j].strip().startswith('>'):
            para.append(body[j]); j += 1
        out.append(inline(' '.join(p.strip() for p in para)))
        i = j

    close_lists()
    write_doc(title, '\n'.join(out))

def split_row(line):
    line = line.strip()
    if line.startswith('|'): line = line[1:]
    if line.endswith('|'): line = line[:-1]
    # split on unescaped pipes
    return [c.strip() for c in re.split(r'(?<!\\)\|', line)]

def emit_table(out, header, sep, rows):
    ncol = len(header)
    aligns = []
    for s in sep:
        s = s.strip()
        if s.startswith(':') and s.endswith(':'): aligns.append('c')
        elif s.endswith(':'): aligns.append('r')
        else: aligns.append('l')
    while len(aligns) < ncol: aligns.append('l')
    colspec = '>{\\raggedright\\arraybackslash}X' * ncol
    out.append('\\begin{table*}[ht]\\small\\noindent')
    out.append('\\begin{tabularx}{\\linewidth}{@{}%s@{}}' % colspec)
    out.append('\\toprule')
    out.append(' & '.join('\\textbf{%s}' % inline(h) for h in header) + ' \\\\')
    out.append('\\midrule')
    for r in rows:
        cells = [inline(c) for c in r] + [''] * (ncol - len(r))
        out.append(' & '.join(cells[:ncol]) + ' \\\\')
    out.append('\\bottomrule')
    out.append('\\end{tabularx}')
    out.append('\\end{table*}')

PREAMBLE = r"""\documentclass[nobib]{tufte-handout}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{xcolor}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{microtype}
\usepackage{fancyhdr}
\usepackage{etoolbox}
\usepackage{needspace}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{listings}
\usepackage{newunicodechar}
\usepackage{hyperref}

\definecolor{rust}{RGB}{185,78,54}
\definecolor{inkmuted}{RGB}{102,102,102}
\hypersetup{colorlinks=true, linkcolor=rust, urlcolor=rust, citecolor=rust}

\newunicodechar{→}{\ensuremath{\rightarrow}}
\newunicodechar{←}{\ensuremath{\leftarrow}}
\newunicodechar{≤}{\ensuremath{\leq}}
\newunicodechar{≥}{\ensuremath{\geq}}
\newunicodechar{≈}{\ensuremath{\approx}}
\newunicodechar{∼}{\ensuremath{\sim}}
\newunicodechar{×}{\ensuremath{\times}}
\newunicodechar{α}{\ensuremath{\alpha}}
\newunicodechar{β}{\ensuremath{\beta}}
\newunicodechar{…}{\ldots}
\newunicodechar{✓}{\ensuremath{\checkmark}}
\newunicodechar{⌈}{\ensuremath{\lceil}}
\newunicodechar{⌉}{\ensuremath{\rceil}}
\newunicodechar{•}{\textbullet}
\newunicodechar{≠}{\ensuremath{\neq}}
\newunicodechar{·}{\textperiodcentered}
\newunicodechar{∞}{\ensuremath{\infty}}
\newunicodechar{≜}{\ensuremath{\triangleq}}
\newunicodechar{⊕}{\ensuremath{\oplus}}
\newunicodechar{—}{---}
\newunicodechar{–}{--}
\newunicodechar{“}{``}
\newunicodechar{”}{''}
\newunicodechar{‘}{`}
\newunicodechar{’}{'}
\newunicodechar{′}{'}
\newunicodechar{⌊}{\ensuremath{\lfloor}}
\newunicodechar{⌋}{\ensuremath{\rfloor}}
\newunicodechar{§}{\S}
\newunicodechar{⇒}{\ensuremath{\Rightarrow}}
\newunicodechar{∈}{\ensuremath{\in}}
\newunicodechar{¼}{\ensuremath{\tfrac14}}
\newunicodechar{⚠}{{\bfseries!}}
\newunicodechar{▼}{\ensuremath{\blacktriangledown}}
\newunicodechar{►}{\ensuremath{\blacktriangleright}}
\newunicodechar{️}{}
\newunicodechar{─}{-}
\newunicodechar{│}{\textbar}
\newunicodechar{├}{+}
\newunicodechar{┌}{+}
\newunicodechar{┬}{+}
\newunicodechar{┐}{+}
\newunicodechar{└}{+}
\newunicodechar{┴}{+}
\newunicodechar{┘}{+}

\lstset{
  basicstyle=\footnotesize\ttfamily,
  breaklines=true, breakatwhitespace=false,
  columns=fullflexible, keepspaces=true, showstringspaces=false,
  extendedchars=true, upquote=true,
  frame=single, rulecolor=\color{gray!40},
  backgroundcolor=\color{gray!6}, framesep=4pt,
  xleftmargin=4pt, xrightmargin=4pt, aboveskip=1em, belowskip=1em,
  literate={→}{{$\rightarrow$}}1 {…}{{\ldots}}1 {≤}{{$\leq$}}1 {≥}{{$\geq$}}1
           {≈}{{$\approx$}}1 {∼}{{$\sim$}}1 {×}{{$\times$}}1 {✓}{{$\checkmark$}}1
           {’}{{'}}1 {‘}{{'}}1 {“}{{``}}1 {”}{{''}}1 {—}{{---}}1 {–}{{--}}1
           {·}{{\textperiodcentered}}1 {≠}{{$\neq$}}1 {⌈}{{$\lceil$}}1 {⌉}{{$\rceil$}}1
           {≜}{{$\triangleq$}}1 {⊕}{{$\oplus$}}1 {∞}{{$\infty$}}1
}

% #### API entries: a bold, page-break-aware run-in heading line.
\newcommand{\apihead}[1]{\par\medskip\needspace{4\baselineskip}%
  \noindent{\normalfont\bfseries #1}\par\nobreak\smallskip\noindent\ignorespaces}

\fancypagestyle{axonaplain}{%
  \fancyhf{}\renewcommand{\headrulewidth}{0pt}\fancyfoot[C]{\thepage}}
"""

def write_doc(title, bodytex):
    sub = SUBTITLE or ''
    ver = VERSION or ''
    titlepage = (
        "\\thispagestyle{empty}\n\\null\\vfill\n\\begin{center}\n"
        "{\\fontsize{42}{46}\\selectfont \\textsc{Axona}\\par}\n\\vspace{0.4em}\n"
        "{\\Large\\itshape %s\\par}\n" % _titlebody(title)
    )
    if sub:
        titlepage += "\\vspace{3em}\n{\\large\\itshape %s\\par}\n" % esc_text(sub)
    titlepage += "\\vspace{3.5em}\n{\\large David A.~Smith\\par}\n{\\itshape\\small Axona.net\\par}\n"
    if ver:
        titlepage += "\\vspace{1.5em}\n{\\small %s\\par}\n" % esc_text(ver)
    titlepage += "\\end{center}\n\\vfill\\null\\newpage\n"

    doc = (PREAMBLE
           + "\n\\begin{document}\n"
           + titlepage
           + "\\pagestyle{axonaplain}\n\\thispagestyle{axonaplain}\n\n"
           + bodytex
           + "\n\\end{document}\n")
    open(OUTPUT, 'w', encoding='utf-8').write(doc)
    print("wrote", OUTPUT)

def _titlebody(title):
    # drop a leading "Axona " from the title since the wordmark already says it
    t = title
    if t.lower().startswith('axona '):
        t = t[6:]
    return esc_text(t)

if __name__ == '__main__':
    main()
