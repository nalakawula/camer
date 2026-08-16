package main

import "testing"

func TestDiffTextIdentical(t *testing.T) {
	d := DiffText("a\nb\n", "a\nb\n")
	if !d.Identical || len(d.Hunks) != 0 {
		t.Fatalf("expected no changes, got %+v", d)
	}
}

func TestDiffTextFirstDeploy(t *testing.T) {
	d := DiffText("", "a\nb\n")
	if d.Added != 2 || d.Removed != 0 || len(d.Hunks) != 1 {
		t.Fatalf("expected 2 additions in one hunk, got %+v", d)
	}
	if d.Hunks[0].NewStart != 1 || d.Hunks[0].NewLines != 2 {
		t.Fatalf("unexpected hunk header: %+v", d.Hunks[0])
	}
}

func TestDiffTextChangeInMiddle(t *testing.T) {
	old := "site.com {\n\treverse_proxy localhost:8080\n\tencode gzip\n}\n"
	updated := "site.com {\n\treverse_proxy localhost:9090\n\tencode gzip zstd\n}\n"
	d := DiffText(old, updated)
	if d.Added != 2 || d.Removed != 2 {
		t.Fatalf("expected 2 added / 2 removed, got +%d -%d", d.Added, d.Removed)
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("expected a single hunk, got %d", len(d.Hunks))
	}
	h := d.Hunks[0]
	if h.OldStart != 1 || h.NewStart != 1 || h.OldLines != 4 || h.NewLines != 4 {
		t.Fatalf("unexpected hunk bounds: %+v", h)
	}
	// Line numbers must stay consistent with each side's own numbering.
	for _, l := range h.Lines {
		if l.Op == "-" && l.New != 0 {
			t.Fatalf("removed line carries a new line number: %+v", l)
		}
		if l.Op == "+" && l.Old != 0 {
			t.Fatalf("added line carries an old line number: %+v", l)
		}
	}
}

func TestDiffTextSplitsDistantChanges(t *testing.T) {
	old := "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n"
	updated := "1x\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15x\n"
	d := DiffText(old, updated)
	if len(d.Hunks) != 2 {
		t.Fatalf("expected 2 hunks for changes far apart, got %d", len(d.Hunks))
	}
	if n := len(d.Hunks[0].Lines); n != 1+diffContext+1 { // one -, one +, trailing context
		t.Fatalf("unexpected first hunk size %d", n)
	}
}
