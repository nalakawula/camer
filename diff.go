package main

import "strings"

// diffContext is the number of unchanged lines kept around each change.
const diffContext = 3

// maxDiffCells caps the LCS table size; beyond it the two versions are
// reported as a wholesale replacement instead of a line-by-line diff.
const maxDiffCells = 4 << 20

// DiffLine is a single line of a diff. Op is " " (context), "+" (added) or
// "-" (removed); Old/New are 1-based line numbers, zero when not applicable.
type DiffLine struct {
	Op   string `json:"op"`
	Old  int    `json:"old,omitempty"`
	New  int    `json:"new,omitempty"`
	Text string `json:"text"`
}

// DiffHunk is a contiguous run of changed lines plus surrounding context.
type DiffHunk struct {
	OldStart int        `json:"old_start"`
	OldLines int        `json:"old_lines"`
	NewStart int        `json:"new_start"`
	NewLines int        `json:"new_lines"`
	Lines    []DiffLine `json:"lines"`
}

// Diff is a line-based comparison of two Caddyfiles.
type Diff struct {
	Hunks     []DiffHunk `json:"hunks"`
	Added     int        `json:"added"`
	Removed   int        `json:"removed"`
	Identical bool       `json:"identical"`
	// Truncated is true when the inputs were too large to diff precisely and
	// the result is a whole-file replacement.
	Truncated bool `json:"truncated"`
}

// DiffText compares two texts line by line and returns hunks with context.
func DiffText(oldText, newText string) Diff {
	a, b := splitLines(oldText), splitLines(newText)
	lines, truncated := diffLines(a, b)

	d := Diff{Hunks: hunkify(lines), Truncated: truncated}
	if d.Hunks == nil {
		d.Hunks = []DiffHunk{}
	}
	for _, l := range lines {
		switch l.Op {
		case "+":
			d.Added++
		case "-":
			d.Removed++
		}
	}
	d.Identical = d.Added == 0 && d.Removed == 0
	return d
}

// splitLines normalizes line endings and splits into lines, dropping the
// trailing empty element produced by a final newline.
func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	return strings.Split(s, "\n")
}

// diffLines produces the full ordered line list for a and b. Common prefixes
// and suffixes are matched cheaply so the quadratic LCS only runs on the part
// that actually changed.
func diffLines(a, b []string) ([]DiffLine, bool) {
	p := 0
	for p < len(a) && p < len(b) && a[p] == b[p] {
		p++
	}
	s := 0
	for s < len(a)-p && s < len(b)-p && a[len(a)-1-s] == b[len(b)-1-s] {
		s++
	}

	out := make([]DiffLine, 0, len(a)+len(b))
	for i := 0; i < p; i++ {
		out = append(out, DiffLine{Op: " ", Old: i + 1, New: i + 1, Text: a[i]})
	}
	mid, truncated := lcsLines(a[p:len(a)-s], b[p:len(b)-s], p)
	out = append(out, mid...)
	for i := 0; i < s; i++ {
		oi, ni := len(a)-s+i, len(b)-s+i
		out = append(out, DiffLine{Op: " ", Old: oi + 1, New: ni + 1, Text: a[oi]})
	}
	return out, truncated
}

// lcsLines diffs the differing middles via a longest-common-subsequence table.
// off is the number of lines already consumed as a common prefix, which is the
// same on both sides, so it shifts both line numberings equally.
func lcsLines(a, b []string, off int) ([]DiffLine, bool) {
	n, m := len(a), len(b)
	if n == 0 || m == 0 || n*m > maxDiffCells {
		out := make([]DiffLine, 0, n+m)
		for i := 0; i < n; i++ {
			out = append(out, DiffLine{Op: "-", Old: off + i + 1, Text: a[i]})
		}
		for j := 0; j < m; j++ {
			out = append(out, DiffLine{Op: "+", New: off + j + 1, Text: b[j]})
		}
		return out, n > 0 && m > 0
	}

	// tbl[i][j] is the LCS length of a[i:] and b[j:], flattened row-major.
	tbl := make([]int32, (n+1)*(m+1))
	at := func(i, j int) int32 { return tbl[i*(m+1)+j] }
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			switch {
			case a[i] == b[j]:
				tbl[i*(m+1)+j] = at(i+1, j+1) + 1
			case at(i+1, j) >= at(i, j+1):
				tbl[i*(m+1)+j] = at(i+1, j)
			default:
				tbl[i*(m+1)+j] = at(i, j+1)
			}
		}
	}

	out := make([]DiffLine, 0, n+m)
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case a[i] == b[j]:
			out = append(out, DiffLine{Op: " ", Old: off + i + 1, New: off + j + 1, Text: a[i]})
			i, j = i+1, j+1
		case at(i+1, j) >= at(i, j+1):
			out = append(out, DiffLine{Op: "-", Old: off + i + 1, Text: a[i]})
			i++
		default:
			out = append(out, DiffLine{Op: "+", New: off + j + 1, Text: b[j]})
			j++
		}
	}
	for ; i < n; i++ {
		out = append(out, DiffLine{Op: "-", Old: off + i + 1, Text: a[i]})
	}
	for ; j < m; j++ {
		out = append(out, DiffLine{Op: "+", New: off + j + 1, Text: b[j]})
	}
	return out, false
}

// hunkify keeps only changed lines plus diffContext lines around them,
// grouping each contiguous run into a hunk.
func hunkify(lines []DiffLine) []DiffHunk {
	keep := make([]bool, len(lines))
	for i, l := range lines {
		if l.Op == " " {
			continue
		}
		lo, hi := i-diffContext, i+diffContext
		if lo < 0 {
			lo = 0
		}
		if hi >= len(lines) {
			hi = len(lines) - 1
		}
		for k := lo; k <= hi; k++ {
			keep[k] = true
		}
	}

	var out []DiffHunk
	for i := 0; i < len(lines); {
		if !keep[i] {
			i++
			continue
		}
		j := i
		for j < len(lines) && keep[j] {
			j++
		}
		h := DiffHunk{Lines: lines[i:j]}
		for _, l := range lines[i:j] {
			if l.Op != "+" {
				if h.OldStart == 0 {
					h.OldStart = l.Old
				}
				h.OldLines++
			}
			if l.Op != "-" {
				if h.NewStart == 0 {
					h.NewStart = l.New
				}
				h.NewLines++
			}
		}
		out = append(out, h)
		i = j
	}
	return out
}
