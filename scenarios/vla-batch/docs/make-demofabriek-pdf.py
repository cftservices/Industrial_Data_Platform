#!/usr/bin/env python3
"""
Genereer 'De demofabriek in vogelvlucht' als PDF.

Leest factory-model/isa95-vla.json zodat de tag-tabellen, het recept, de KPI's
en het kostenmodel nooit uit de pas kunnen lopen met de draaiende fabriek.
Prozadelen staan hier in het script; feiten komen uit het model.

    cd scenarios/vla-batch
    python docs/make-demofabriek-pdf.py

Uitvoer: docs/demofabriek.pdf
"""
from __future__ import annotations

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODEL = json.loads((ROOT / "factory-model" / "isa95-vla.json").read_text(encoding="utf-8"))
OUT = HERE / "demofabriek.pdf"

# ── palet ───────────────────────────────────────────────────────────────────
INK = colors.HexColor("#16202B")
BLUE = colors.HexColor("#1B3A5C")
STEEL = colors.HexColor("#41627F")
ACCENT = colors.HexColor("#C0562A")
MUTED = colors.HexColor("#6B7C8C")
RULE = colors.HexColor("#C9D4DD")
WASH = colors.HexColor("#EEF3F7")
CREAM = colors.HexColor("#FBF6EE")

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


def nodash(s: str) -> str:
    """Em-dash en en-dash zijn hier niet toegestaan als leesteken."""
    return (s or "").replace("—", ",").replace("–", "-")


def nl(x, dec=0):
    """Nederlandse notatie: punt als duizendtal, komma als decimaal."""
    return f"{x:,.{dec}f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def nlg(x):
    """Zoals :g, maar met een decimale komma."""
    return f"{x:g}".replace(".", ",")


# ── stijlen ─────────────────────────────────────────────────────────────────
_ss = getSampleStyleSheet()


def S(name, **kw):
    base = kw.pop("parent", _ss["BodyText"])
    return ParagraphStyle(name, parent=base, **kw)


ST = {
    "h1": S("h1", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=BLUE,
            spaceBefore=0, spaceAfter=2),
    "kicker": S("kicker", fontName="Helvetica-Bold", fontSize=8, leading=11,
                textColor=ACCENT, spaceAfter=3),
    "lead": S("lead", fontName="Helvetica-Oblique", fontSize=10.5, leading=15,
              textColor=STEEL, spaceBefore=4, spaceAfter=9),
    "body": S("body", fontName="Helvetica", fontSize=9.6, leading=14.2,
              textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7),
    "h2": S("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=BLUE,
            spaceBefore=11, spaceAfter=4),
    "h3": S("h3", fontName="Helvetica-Bold", fontSize=9.6, leading=13, textColor=ACCENT,
            spaceBefore=8, spaceAfter=2),
    "small": S("small", fontName="Helvetica", fontSize=8.2, leading=11.6, textColor=MUTED,
               spaceAfter=5),
    "cell": S("cell", fontName="Helvetica", fontSize=8, leading=10.6, textColor=INK),
    "cellb": S("cellb", fontName="Helvetica-Bold", fontSize=8, leading=10.6, textColor=BLUE),
    "cellm": S("cellm", fontName="Helvetica", fontSize=7.6, leading=10.2, textColor=MUTED),
    "cellr": S("cellr", fontName="Helvetica", fontSize=8, leading=10.6, textColor=INK,
               alignment=TA_RIGHT),
    "cellbr": S("cellbr", fontName="Helvetica-Bold", fontSize=8, leading=10.6, textColor=BLUE,
                alignment=TA_RIGHT),
    "mono": S("mono", fontName="Courier", fontSize=8, leading=11.4, textColor=BLUE),
    "monosm": S("monosm", fontName="Courier", fontSize=7.4, leading=10, textColor=INK),
    "ttl": S("ttl", fontName="Helvetica-Bold", fontSize=32, leading=36, textColor=BLUE,
             alignment=TA_CENTER),
    "sub": S("sub", fontName="Helvetica", fontSize=13, leading=18, textColor=STEEL,
             alignment=TA_CENTER),
    "tiny": S("tiny", fontName="Helvetica", fontSize=7.6, leading=10.4, textColor=MUTED,
              alignment=TA_CENTER),
}


def P(t, s="body"):
    return Paragraph(nodash(t), ST[s])


def bullets(items, style="body"):
    """Opsomming zonder em-dashes, met een strak bolletje."""
    rows = [[Paragraph("&bull;", ST["cellb"]), P(t, style)] for t in items]
    tb = Table(rows, colWidths=[5 * mm, CONTENT_W - 5 * mm])
    tb.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tb


# ── losse bouwstenen ────────────────────────────────────────────────────────
class Rule(Flowable):
    def __init__(self, w=CONTENT_W, color=RULE, thick=0.6, pad=3):
        super().__init__()
        self.w, self.color, self.thick, self.pad = w, color, thick, pad
        self.height = thick + 2 * pad

    def wrap(self, aw, ah):
        return self.w, self.height

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thick)
        self.canv.line(0, self.pad, self.w, self.pad)


def callout(title, text, tone="wash"):
    bg = WASH if tone == "wash" else CREAM
    bar = BLUE if tone == "wash" else ACCENT
    inner = [P(title, "h3"), P(text, "body")]
    tb = Table([[inner]], colWidths=[CONTENT_W])
    tb.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return tb


def datatable(header, rows, widths, align_right=()):
    hdr = [Paragraph(nodash(h), ST["cellbr"] if i in align_right else ST["cellb"])
           for i, h in enumerate(header)]
    data = [hdr]
    for r in rows:
        row = []
        for i, c in enumerate(r):
            if isinstance(c, Paragraph):
                if i in align_right:
                    # zelfde tekst, maar rechts uitgelijnd; ALIGN op de tabel
                    # raakt de binnenkant van een Paragraph niet.
                    c = Paragraph(c.text, ParagraphStyle(
                        c.style.name + "_r", parent=c.style, alignment=TA_RIGHT))
            else:
                c = Paragraph(nodash(str(c)),
                              ST["cellr"] if i in align_right else ST["cell"])
            row.append(c)
        data.append(row)
    tb = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, BLUE),
        ("LINEBELOW", (0, 1), (-1, -2), 0.3, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAFC")]),
    ]
    for c in align_right:
        style.append(("ALIGN", (c, 1), (c, -1), "RIGHT"))
    tb.setStyle(TableStyle(style))
    return tb


class ProcessFlow(Flowable):
    """De lijn als vijf stappen achter elkaar, met de fasetijd eronder."""

    def __init__(self, steps, width=CONTENT_W):
        super().__init__()
        self.steps = steps
        self.width = width
        self.height = 30 * mm

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        n = len(self.steps)
        gap = 5 * mm
        bw = (self.width - gap * (n - 1)) / n
        bh = 17 * mm
        y = self.height - bh - 4 * mm
        for i, (name, eq, sub) in enumerate(self.steps):
            x = i * (bw + gap)
            c.setFillColor(WASH if i % 2 == 0 else colors.white)
            c.setStrokeColor(STEEL)
            c.setLineWidth(0.9)
            c.roundRect(x, y, bw, bh, 2 * mm, stroke=1, fill=1)
            c.setFillColor(ACCENT)
            c.setFont("Helvetica-Bold", 7)
            c.drawCentredString(x + bw / 2, y + bh - 5.5 * mm, str(i + 1))
            c.setFillColor(BLUE)
            c.setFont("Helvetica-Bold", 8.6)
            c.drawCentredString(x + bw / 2, y + bh - 9.8 * mm, name)
            c.setFillColor(INK)
            c.setFont("Courier", 6.4)
            c.drawCentredString(x + bw / 2, y + bh - 13.2 * mm, eq)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.8)
            c.drawCentredString(x + bw / 2, y - 4.2 * mm, sub)
            if i < n - 1:
                ax = x + bw + 0.6 * mm
                ay = y + bh / 2
                c.setStrokeColor(ACCENT)
                c.setLineWidth(1.1)
                c.line(ax, ay, ax + gap - 1.2 * mm, ay)
                c.setFillColor(ACCENT)
                p = c.beginPath()
                p.moveTo(ax + gap - 1.2 * mm, ay)
                p.lineTo(ax + gap - 3.2 * mm, ay + 1.1 * mm)
                p.lineTo(ax + gap - 3.2 * mm, ay - 1.1 * mm)
                p.close()
                c.drawPath(p, fill=1, stroke=0)


class StackDiagram(Flowable):
    """De keten van fabriek naar scherm, als lagen onder elkaar."""

    def __init__(self, layers, width=CONTENT_W):
        super().__init__()
        self.layers = layers
        self.width = width
        self.row_h = 13 * mm
        self.gap = 4.6 * mm
        self.height = len(layers) * self.row_h + (len(layers) - 1) * self.gap

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        for i, (tag, title, detail, tone) in enumerate(self.layers):
            y = self.height - (i + 1) * self.row_h - i * self.gap
            fill = {"src": CREAM, "bus": WASH, "sink": colors.white}[tone]
            edge = {"src": ACCENT, "bus": BLUE, "sink": STEEL}[tone]
            c.setFillColor(fill)
            c.setStrokeColor(edge)
            c.setLineWidth(1.0 if tone == "bus" else 0.7)
            c.roundRect(0, y, self.width, self.row_h, 1.8 * mm, stroke=1, fill=1)
            c.setFillColor(edge)
            c.rect(0, y, 22 * mm, self.row_h, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont("Helvetica-Bold", 7.2)
            c.drawCentredString(11 * mm, y + self.row_h / 2 - 2.2, tag)
            c.setFillColor(BLUE)
            c.setFont("Helvetica-Bold", 9)
            c.drawString(26 * mm, y + self.row_h - 5.4 * mm, title)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7.4)
            c.drawString(26 * mm, y + 3.6 * mm, detail)
            if i < len(self.layers) - 1:
                cx = self.width / 2
                c.setStrokeColor(ACCENT)
                c.setLineWidth(1.2)
                c.line(cx, y, cx, y - self.gap + 1.6 * mm)
                c.setFillColor(ACCENT)
                p = c.beginPath()
                p.moveTo(cx, y - self.gap)
                p.lineTo(cx - 1.3 * mm, y - self.gap + 2 * mm)
                p.lineTo(cx + 1.3 * mm, y - self.gap + 2 * mm)
                p.close()
                c.drawPath(p, fill=1, stroke=0)


class ViscosityCurve(Flowable):
    """g tegen piektemperatuur bij volle hold, met de spec-ondergrens erin."""

    def __init__(self, width=CONTENT_W * 0.62, height=52 * mm):
        super().__init__()
        self.width, self.height = width, height

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        l, b = 14 * mm, 10 * mm
        w, h = self.width - l - 4 * mm, self.height - b - 6 * mm
        t0, t1, v0, v1 = 66.0, 92.0, 0.0, 280.0

        def px(t):
            return l + (t - t0) / (t1 - t0) * w

        def py(v):
            return b + (v - v0) / (v1 - v0) * h

        c.setStrokeColor(RULE)
        c.setLineWidth(0.4)
        for v in (0, 70, 140, 210, 280):
            c.line(l, py(v), l + w, py(v))
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.2)
            c.drawRightString(l - 1.6 * mm, py(v) - 1.8, str(v))
        # spec-band 150 tot 300 cP, hier zichtbaar vanaf 150
        c.setFillColor(colors.HexColor("#E6F0E6"))
        c.rect(l, py(150), w, py(280) - py(150), stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor("#2E7D32"))
        c.setLineWidth(0.8)
        c.setDash(2, 2)
        c.line(l, py(150), l + w, py(150))
        c.setDash()
        c.setFillColor(colors.HexColor("#2E7D32"))
        c.setFont("Helvetica-Bold", 6.4)
        c.drawString(l + 1.6 * mm, py(150) + 1.4 * mm, "spec-ondergrens 150 cP")
        # de curve
        c.setStrokeColor(BLUE)
        c.setLineWidth(1.6)
        p = c.beginPath()
        first = True
        for i in range(121):
            t = t0 + (t1 - t0) * i / 120
            g = max(0.0, min(1.0, (t - 70.0) / (88.0 - 70.0)))
            v = 30.0 + g * 230.0
            if first:
                p.moveTo(px(t), py(v))
                first = False
            else:
                p.lineTo(px(t), py(v))
        c.drawPath(p, stroke=1, fill=0)
        # de twee punten die het verhaal dragen
        for t, lbl, col in ((88.0, "88 C: 260 cP, APPROVED", colors.HexColor("#2E7D32")),
                            (79.4, "79 C: 150 cP, de grens", ACCENT)):
            g = max(0.0, min(1.0, (t - 70.0) / (88.0 - 70.0)))
            v = 30.0 + g * 230.0
            c.setFillColor(col)
            c.circle(px(t), py(v), 1.5 * mm, stroke=0, fill=1)
        c.setStrokeColor(STEEL)
        c.setLineWidth(0.7)
        c.line(l, b, l + w, b)
        c.line(l, b, l, b + h)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.2)
        for t in (70, 76, 82, 88):
            c.drawCentredString(px(t), b - 3.4 * mm, f"{t} C")
        c.setFillColor(STEEL)
        c.setFont("Helvetica-Bold", 6.6)
        c.drawString(l, self.height - 3.4 * mm, "Eind-viscositeit (cP) tegen piektemperatuur, bij volledige hold")


# ── model uitlezen ──────────────────────────────────────────────────────────
LINE = MODEL["enterprise"]["sites"][0]["lines"][0]
AREAS = LINE["areas"]
RECIPE = MODEL["recipes"][0]
COST = MODEL["cost_model"]
PHASE = MODEL["phase_nominal_sec"]
KPIS = MODEL["kpi_targets"]

EQ_ROLE = {
    "receiving-tank-01": "Melk komt binnen en wordt gestandaardiseerd op vet.",
    "process-tank-01": "Vier grondstoffen worden gedoseerd en gemengd onder de agitator.",
    "cook-unit-01": "Het zetmeel verstijfselt. Hier valt de kwaliteitsbeslissing.",
    "cooler-01": "Terug naar afvultemperatuur, zonder de structuur te breken.",
    "filler-01": "Vullen in packs van 1 liter, met afkeurtelling.",
}


def all_tags():
    out = []
    for a in AREAS:
        for wc in a["work_centers"]:
            for t in wc["tags"]:
                out.append((a["name"], wc["equipment_id"], t))
    return out


# ── pagina-sjablonen ────────────────────────────────────────────────────────
def cover_page(canv, doc):
    canv.saveState()
    canv.setFillColor(BLUE)
    canv.rect(0, PAGE_H - 62 * mm, PAGE_W, 62 * mm, stroke=0, fill=1)
    canv.setFillColor(ACCENT)
    canv.rect(0, PAGE_H - 65 * mm, PAGE_W, 3 * mm, stroke=0, fill=1)
    canv.setFillColor(colors.white)
    canv.setFont("Helvetica-Bold", 8)
    canv.drawString(MARGIN, PAGE_H - 18 * mm, "DAIRYWORKS  /  LIJN VLA")
    canv.setFont("Helvetica", 8)
    canv.drawRightString(PAGE_W - MARGIN, PAGE_H - 18 * mm, "Gefingeerde fabriek, geanonimiseerd")
    canv.setFillColor(colors.white)
    canv.setFont("Helvetica-Bold", 29)
    canv.drawString(MARGIN, PAGE_H - 38 * mm, "De demofabriek")
    canv.setFont("Helvetica", 17)
    canv.drawString(MARGIN, PAGE_H - 50 * mm, "in vogelvlucht")
    canv.setFillColor(MUTED)
    canv.setFont("Helvetica", 7.4)
    canv.drawCentredString(PAGE_W / 2, 12 * mm,
                           "Gegenereerd uit factory-model/isa95-vla.json. Wijzig het model, niet dit document.")
    canv.restoreState()


def body_page(canv, doc):
    canv.saveState()
    canv.setStrokeColor(RULE)
    canv.setLineWidth(0.5)
    canv.line(MARGIN, PAGE_H - MARGIN + 6 * mm, PAGE_W - MARGIN, PAGE_H - MARGIN + 6 * mm)
    canv.setFillColor(MUTED)
    canv.setFont("Helvetica", 7.2)
    canv.drawString(MARGIN, PAGE_H - MARGIN + 8.4 * mm, "De demofabriek in vogelvlucht")
    canv.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 8.4 * mm, "DairyWorks, lijn Vla")
    canv.setFillColor(ACCENT)
    canv.setFont("Helvetica-Bold", 8)
    canv.drawCentredString(PAGE_W / 2, 12 * mm, str(canv.getPageNumber()))
    canv.restoreState()


def build():
    doc = BaseDocTemplate(str(OUT), pagesize=A4,
                          leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=MARGIN, bottomMargin=MARGIN,
                          title="De demofabriek in vogelvlucht",
                          author="DairyWorks, lijn Vla", subject="Vla Batch demo")
    frame_cover = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 65 * mm - MARGIN - 4 * mm, id="cov")
    frame_body = Frame(MARGIN, MARGIN + 6 * mm, CONTENT_W, PAGE_H - 2 * MARGIN - 6 * mm, id="bod")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame_cover], onPage=cover_page),
        PageTemplate(id="body", frames=[frame_body], onPage=body_page),
    ])
    doc.build(story())


# ── de inhoud ───────────────────────────────────────────────────────────────
def story():
    s = []
    a = s.append

    # ---------- omslag ----------
    a(Spacer(1, 10 * mm))
    a(P("Een draaiende, gesimuleerde zuivelfabriek die in twee minuten een batch "
        "chocoladevla maakt, van melkontvangst tot pallet. Dit document loopt er "
        "in een keer doorheen: de lijn, het model, de bus, de MES-laag en de "
        "schermen. Lees het van voor naar achter en je weet wat er staat, wat het "
        "doet en waar je aan draait.", "lead"))
    a(Rule())
    a(Spacer(1, 4 * mm))

    facts = [
        ["Product", RECIPE["product_name"], "Recept", RECIPE["recipe_id"]],
        ["Batchgrootte", f"{nl(RECIPE['basis_L'])} L", "Packs per batch",
         nl(int(RECIPE["basis_L"] / RECIPE["pack_size_L"]))],
        ["Procesdelen", f"{len(AREAS)} areas", "Equipment", f"{sum(len(x['work_centers']) for x in AREAS)} units"],
        ["Signalen", f"{len(all_tags()) + len(LINE['batch_object']['tags'])} tags", "Doorlooptijd demo", "ongeveer 2 minuten"],
        ["Standaarden", "ISA-95 en ISA-88", "Bus", "MQTT, unified namespace"],
    ]
    rows = []
    for r in facts:
        rows.append([Paragraph(nodash(r[0]), ST["cellm"]), Paragraph(nodash(r[1]), ST["cellb"]),
                     Paragraph(nodash(r[2]), ST["cellm"]), Paragraph(nodash(r[3]), ST["cellb"])])
    tb = Table(rows, colWidths=[CONTENT_W * 0.19, CONTENT_W * 0.31, CONTENT_W * 0.19, CONTENT_W * 0.31])
    tb.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    a(tb)
    a(Spacer(1, 8 * mm))
    a(callout("Waar dit over gaat",
              "De fabriek is echt genoeg om er beslissingen op te nemen en klein genoeg om "
              "op een enkele server te draaien. Een onderkookte batch wordt hier niet blind "
              "afgevuld maar tegengehouden, en dat is precies waar het om draait: ruwe "
              "meetwaarden die tot een echt besluit leiden.", "cream"))
    a(Spacer(1, 6 * mm))
    a(P("Leeswijzer: hoofdstuk 1 tot en met 3 volgen de vla door de lijn. Hoofdstuk 4 en 5 "
        "laten zien hoe die metingen bij een scherm terechtkomen. Hoofdstuk 6 tot en met 8 "
        "gaan over wat de fabriek ervan maakt: orders, rapporten, kentallen. Hoofdstuk 9 "
        "is de bedieningshandleiding, hoofdstuk 10 zegt eerlijk wat er niet in zit.", "small"))

    a(NextPageTemplate("body"))
    a(PageBreak())

    # ---------- 1. de lijn ----------
    a(P("HOOFDSTUK 1", "kicker"))
    a(P("De lijn, van melk tot pack", "h1"))
    a(P("Vijf procesdelen achter elkaar. Elke stap duurt in de demo ongeveer een halve minuut.", "lead"))

    steps = [
        ("Receiving", "receiving-tank-01", f"{PHASE.get('DOSING', 30)} s"),
        ("Mixing", "process-tank-01", f"{PHASE.get('DOSING', 30)} s"),
        ("Cook", "cook-unit-01", f"{PHASE.get('COOKING', 60)} s"),
        ("Cooling", "cooler-01", f"{PHASE.get('COOLING', 30)} s"),
        ("Filling", "filler-01", f"{PHASE.get('FILLING', 30)} s"),
    ]
    a(ProcessFlow(steps))
    a(Spacer(1, 1 * mm))

    a(P("Wat er per stap gebeurt", "h2"))
    rows = []
    for area in AREAS:
        for wc in area["work_centers"]:
            rows.append([
                Paragraph(nodash(area["name"]), ST["cellb"]),
                Paragraph(nodash(wc["equipment_id"]), ST["monosm"]),
                Paragraph(nodash(EQ_ROLE.get(wc["equipment_id"], wc.get("description", ""))), ST["cell"]),
                Paragraph(nodash(str(wc.get("physics_type", ""))), ST["cellm"]),
                Paragraph(str(len(wc["tags"])), ST["cell"]),
            ])
    a(datatable(["Area", "Equipment", "Rol in het proces", "Type", "Tags"], rows,
                [CONTENT_W * 0.13, CONTENT_W * 0.21, CONTENT_W * 0.40,
                 CONTENT_W * 0.16, CONTENT_W * 0.10], align_right=(4,)))

    a(P("De toestandsmachine", "h2"))
    a(P("De batch loopt langs zes toestanden: <font face='Courier' size='8.4'>"
        + " &rarr; ".join(MODEL["batch_states"]) +
        "</font>. Het equipment eronder kent zijn eigen toestanden ("
        + ", ".join(MODEL["equipment_states"]) +
        "), die los van de batch bewegen. Dat onderscheid is niet cosmetisch: een "
        "kookketel kan Dirty zijn terwijl er helemaal geen batch loopt, en daar hangt "
        "de reinigingslogica aan.", "body"))

    a(Spacer(1, 3 * mm))
    a(callout("Tijd in de demo",
              "De fabriek rekent in procestijd en draait die versneld af. Een hold van 300 "
              "procesecondes is op het scherm ongeveer twintig seconden. Het recept blijft "
              "daarmee natuurkundig kloppen terwijl je een hele batch binnen een "
              "presentatie kunt laten zien."))

    a(PageBreak())

    # ---------- 2. het recept ----------
    a(P("HOOFDSTUK 2", "kicker"))
    a(P("Het recept", "h1"))
    a(P(f"{RECIPE['product_name']}, versie {nlg(float(RECIPE['version']))}, "
        f"{nl(RECIPE['basis_L'])} liter per batch.", "lead"))

    dose_rows = []
    mats = {m["material_id"]: m for m in MODEL["materials"]}
    total_kg = sum(d["qty_kg"] for d in RECIPE["doses"])
    for d in RECIPE["doses"]:
        m = mats.get(d["material_id"], {})
        prijs = COST["cost_per_kg_material"].get(d["material_id"])
        dose_rows.append([
            Paragraph(nodash(m.get("name", d["material_id"])), ST["cellb"]),
            Paragraph(nodash(m.get("category", "")), ST["cellm"]),
            nl(d["qty_kg"]),
            nl(d["qty_kg"] / total_kg * 100, 1) + "%",
            nl(prijs, 2) if prijs is not None else "-",
            nl(d["qty_kg"] * prijs) if prijs is not None else "-",
        ])
    grondstofkosten = sum(d["qty_kg"] * COST["cost_per_kg_material"].get(d["material_id"], 0)
                          for d in RECIPE["doses"])
    dose_rows.append([
        Paragraph("Totaal", ST["cellb"]), Paragraph("", ST["cell"]),
        Paragraph(f"<b>{nl(total_kg)}</b>", ST["cell"]),
        Paragraph("<b>100%</b>", ST["cell"]), Paragraph("", ST["cell"]),
        Paragraph(f"<b>{nl(grondstofkosten)}</b>", ST["cell"]),
    ])
    a(datatable(["Grondstof", "Categorie", "kg", "Aandeel", "EUR/kg", "EUR"], dose_rows,
                [CONTENT_W * 0.22, CONTENT_W * 0.20, CONTENT_W * 0.13, CONTENT_W * 0.13,
                 CONTENT_W * 0.14, CONTENT_W * 0.18], align_right=(2, 3, 4, 5)))

    a(P("Procesparameters", "h2"))
    spec = RECIPE["viscosity_spec_cP"]
    prow = [
        ["Kooksetpoint", f"{RECIPE['cook_setpoint_C']} C", "De temperatuur waarbij het zetmeel volledig verstijfselt."],
        ["Hold-tijd", f"{RECIPE['hold_sec']} s", "Procesecondes op temperatuur, niet kloktijd."],
        ["Koeldoel", f"{RECIPE['cool_target_C']} C", "Afvultemperatuur."],
        ["Viscositeitsspec", f"{spec['min']} tot {spec['max']} cP", "Buiten deze band gaat de batch niet door."],
        ["Packgrootte", f"{nlg(RECIPE['pack_size_L'])} L",
         f"Dichtheid {nlg(MODEL['product_density_kg_L'])} kg/L."],
        ["Packs per pallet", nl(MODEL["packs_per_pallet"]), "Bepaalt de handling unit."],
    ]
    rows = [[Paragraph(nodash(r[0]), ST["cellb"]), Paragraph(nodash(r[1]), ST["mono"]),
             Paragraph(nodash(r[2]), ST["cell"])] for r in prow]
    a(datatable(["Parameter", "Waarde", "Betekenis"], rows,
                [CONTENT_W * 0.24, CONTENT_W * 0.22, CONTENT_W * 0.54]))

    a(P("Het pad door de fabriek", "h2"))
    a(Paragraph(nodash(" &rarr; ".join(RECIPE["process_path"])), ST["mono"]))
    a(Spacer(1, 4 * mm))
    a(callout("Vulgewicht en de wet",
              "De vulcontrole hanteert een nominale inhoud van "
              f"{MODEL['fill_limits_ml']['nominal']} ml met T1 op {MODEL['fill_limits_ml']['T1']} ml "
              f"en T2 op {MODEL['fill_limits_ml']['T2']} ml. Dat volgt de tabel voor toegestane "
              "negatieve afwijking uit richtlijn 76/211/EEG. De vaak genoemde 2,5 procent staat "
              "niet in die richtlijn en komt uit de steekproefplannen. In de schermen staat die "
              "dus als praktijknorm gelabeld, niet als wettelijke eis.", "cream"))

    a(PageBreak())

    # ---------- 3. de solve ----------
    a(P("HOOFDSTUK 3", "kicker"))
    a(P("Waar de beslissing valt", "h1"))
    a(P("Een formule met twee variabelen bepaalt of een batch de deur uit mag.", "lead"))

    a(P("Zetmeel verstijfselt pas boven de 70 graden, en volledig rond de 88. Hoe ver dat "
        "proces komt hangt af van twee dingen: hoe heet het is geworden en hoe lang het daar "
        "gebleven is. Die twee samen leveren een verstijfselingsgraad op, en die bepaalt de "
        "eind-viscositeit rechtstreeks.", "body"))

    fm = Table([[Paragraph(
        "g = clamp((piektemp - 70) / (88 - 70), 0, 1) &times; clamp(hold_verstreken / hold_sec, 0, 1)<br/>"
        "eind_viscositeit_cP = 30 + g &times; 230", ST["mono"])]], colWidths=[CONTENT_W])
    fm.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WASH),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    a(fm)
    a(Spacer(1, 5 * mm))

    curve = ViscosityCurve()
    side = [
        P("Bij het recept", "h3"),
        P("88 graden en volle hold geven een verstijfselingsgraad van 1 en dus ongeveer "
          "260 cP. Dat ligt midden in de spec van 150 tot 300.", "body"),
        P("De kantelpunt", "h3"),
        P("Onder ongeveer 79 graden zakt de viscositeit door de 150 cP. Vanaf daar is de "
          "batch niet meer verkoopbaar als vla.", "body"),
    ]
    tb = Table([[curve, side]], colWidths=[CONTENT_W * 0.62, CONTENT_W * 0.38])
    tb.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (1, 0), (1, 0), 8)]))
    a(tb)

    a(P("Het verdict", "h2"))
    vr = MODEL["verdict_rule"]
    a(P(f"De spec loopt van {vr['spec_min_cP']} tot {vr['spec_max_cP']} cP. Daaruit volgt "
        "een van vier oordelen:", "body"))
    vrows = [
        ["APPROVED", "Binnen spec en geen open kritieke afwijking. De batch mag door."],
        ["HOLD", "Er is een afwijking die iemand moet beoordelen. De batch wacht."],
        ["REJECTED", "Viscositeit onder de ondergrens, of een kritieke afwijking blijft open."],
        ["PENDING", "Nog geen uitspraak, de batch is niet klaar."],
    ]
    rows = [[Paragraph(nodash(r[0]), ST["monosm"]), Paragraph(nodash(r[1]), ST["cell"])]
            for r in vrows]
    a(datatable(["Verdict", "Wanneer"], rows, [CONTENT_W * 0.22, CONTENT_W * 0.78]))
    a(Spacer(1, 3 * mm))
    a(P("Dat oordeel wordt verderop hard gehandhaafd. Verpakken in een handling unit lukt "
        "alleen bij APPROVED, dus een afgekeurde batch kan het koelmagazijn fysiek niet in. "
        "De regel staat niet in de code maar in het model, onder "
        "<font face='Courier' size='8.4'>verdict_rule</font>.", "body"))

    a(P("Storingen die je kunt injecteren", "h2"))
    frows = [
        ["cook_undertemp", "Zet een plafond op de piektemperatuur. Bij ernst 1,0 komt de "
                           "ketel niet boven de 70 graden en is er geen verstijfseling.",
         "Viscositeit onder spec, verdict HOLD of REJECTED."],
        ["agitator_slow", "Remt de agitator af.", "Slechtere menging tijdens doseren."],
        ["dose_off", "Laat een dosering achter bij het setpoint.", "Afwijking op de massabalans."],
    ]
    rows = [[Paragraph(nodash(r[0]), ST["monosm"]), Paragraph(nodash(r[1]), ST["cell"]),
             Paragraph(nodash(r[2]), ST["cell"])] for r in frows]
    a(datatable(["Storing", "Wat hij doet", "Wat je ziet"], rows,
                [CONTENT_W * 0.20, CONTENT_W * 0.44, CONTENT_W * 0.36]))

    a(Spacer(1, 3 * mm))
    a(callout("De tweede helft van hetzelfde verhaal",
              "Naast dit reactieve spoor loopt een voorspellend spoor. De opwarmtijd van de "
              "kookketel wordt over de laatste twintig batches gevolgd. Loopt die 35 procent "
              "boven de schone basislijn, dan komt er een melding om te reinigen, ruim voordat "
              "de ketel op Dirty springt en nieuw werk weigert. Waarschuwen voor het misgaat, "
              "in plaats van erna."))

    a(PageBreak())

    # ---------- 4. het model ----------
    a(P("HOOFDSTUK 4", "kicker"))
    a(P("Het model onder de fabriek", "h1"))
    a(P("Een enkel JSON-bestand is de waarheid. De fabriek, de bus en de MES-laag lezen alle drie hetzelfde.", "lead"))

    a(P("De hierarchie volgt ISA-95: onderneming, vestiging, lijn, area, equipment. Het "
        "recept en de fasen volgen ISA-88. Beide zitten in "
        "<font face='Courier' size='8.4'>factory-model/isa95-vla.json</font>, dat read-only "
        "wordt aangekoppeld in elke container die het nodig heeft. Wie een tag wil toevoegen "
        "verandert het model, niet de code.", "body"))

    ent = MODEL["enterprise"]
    hrows = [
        ["Enterprise", ent["name"], ent["id"]],
        ["Site", ent["sites"][0]["name"], ent["sites"][0]["id"]],
        ["Line", LINE["name"], LINE["id"]],
        ["Areas", ", ".join(x["name"] for x in AREAS), f"{len(AREAS)} stuks"],
        ["Equipment", ", ".join(w["equipment_id"] for x in AREAS for w in x["work_centers"]),
         f"{sum(len(x['work_centers']) for x in AREAS)} stuks"],
    ]
    rows = [[Paragraph(nodash(r[0]), ST["cellb"]), Paragraph(nodash(r[1]), ST["cell"]),
             Paragraph(nodash(r[2]), ST["monosm"])] for r in hrows]
    a(datatable(["Niveau", "Naam", "Id"], rows,
                [CONTENT_W * 0.16, CONTENT_W * 0.62, CONTENT_W * 0.22]))

    a(P("Alle signalen", "h2"))
    a(P(f"{len(all_tags())} equipment-tags plus {len(LINE['batch_object']['tags'])} op het "
        "batchniveau. Een W betekent dat de tag beschrijfbaar is, dus dat er vanuit de "
        "besturing een setpoint op gezet kan worden.", "small"))

    trows = []
    for area_name, eq, t in all_tags():
        trows.append([
            Paragraph(nodash(eq), ST["monosm"]),
            Paragraph(nodash(t["id"].split(":", 1)[1]), ST["monosm"]),
            Paragraph(nodash(t["display_name"]), ST["cell"]),
            Paragraph(nodash(str(t.get("engineering_unit") or "")), ST["cellm"]),
            Paragraph(nodash(t["opcua_datatype"]), ST["cellm"]),
            Paragraph("W" if t.get("writable") else "", ST["cellb"]),
        ])
    for t in LINE["batch_object"]["tags"]:
        trows.append([
            Paragraph("Batch", ST["monosm"]),
            Paragraph(nodash(t["id"].split(":", 1)[1]), ST["monosm"]),
            Paragraph(nodash(t["display_name"]), ST["cell"]),
            Paragraph("", ST["cellm"]),
            Paragraph(nodash(t["opcua_datatype"]), ST["cellm"]),
            Paragraph("", ST["cellb"]),
        ])
    a(datatable(["Equipment", "Tag", "Omschrijving", "Eenheid", "Type", ""], trows,
                [CONTENT_W * 0.21, CONTENT_W * 0.24, CONTENT_W * 0.30,
                 CONTENT_W * 0.09, CONTENT_W * 0.11, CONTENT_W * 0.05]))

    a(PageBreak())

    # ---------- 5. de bus ----------
    a(P("HOOFDSTUK 5", "kicker"))
    a(P("Van meetwaarde naar scherm", "h1"))
    a(P("De fabriek praat OPC-UA. Alles daarna praat MQTT. Daartussen zit een broker die het vertaalt.", "lead"))

    layers = [
        ("PLC", "vla-factory", "OPC-UA server met de batch-toestandsmachine en de natuurkunde erin", "src"),
        ("BUS", "monstermq", "Leest de fabriek zelf uit via zijn OPC-UA-client en publiceert op de UNS", "bus"),
        ("DATA", "mongo en vla-tdengine", "Archief voor de lange termijn, historian voor de trends", "sink"),
        ("MES", "vla-batch-engine", "Orders, batches, monsters, rapporten. Stuurt terug via OPC-UA-methodes", "sink"),
        ("UI", "vla-ui, vla-dashboard, grafana", "Twaalf schermen in twee rollen, plus trends", "sink"),
    ]
    a(StackDiagram(layers))
    a(Spacer(1, 4 * mm))

    a(P("De topicboom ligt vast", "h2"))
    tt = Table([[Paragraph(nodash(
        "DairyWorks/Vla/{Area}/{Equipment}/Status/{tag}<br/>"
        "DairyWorks/Vla/{Area}/{Equipment}/Command/{cmd}<br/>"
        "DairyWorks/Vla/Batch/Status/{state|batch_id|active_recipe}<br/>"
        "DairyWorks/Vla/Batch/Command/{StartBatch|Stop|InjectFault|ClearFault|TakeSample}"),
        ST["mono"])]], colWidths=[CONTENT_W])
    tt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WASH),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    a(tt)
    a(Spacer(1, 4 * mm))
    a(P("Elk bericht draagt dezelfde vier velden, altijd:", "body"))
    a(Paragraph('{"value": &lt;waarde&gt;, "unit": "&lt;eenheid&gt;", "ts": "&lt;iso8601&gt;", "quality": "GOOD"}',
                ST["mono"]))
    a(Spacer(1, 4 * mm))
    a(P("De vorm is bewust saai en bewust vast. Een consument die vandaag een temperatuur "
        "leest, leest morgen een drukwaarde op precies dezelfde manier. Dat is wat een "
        "unified namespace oplevert: niet dat alles op een bus staat, maar dat alles op "
        "dezelfde manier op die bus staat.", "body"))

    a(P("Heen en terug", "h2"))
    a(bullets([
        "<b>Heen, metingen.</b> De broker heeft een eigen OPC-UA-client. Een eenmalige "
        "init-container registreert de fabriek als apparaat, waarna de broker zelf abonneert "
        "op elke statusnode en die op de UNS publiceert. Er zit geen los brugproces tussen.",
        "<b>Terug, commando's.</b> De MES-laag stuurt de fabriek rechtstreeks aan met "
        "OPC-UA-methodes op het batchobject: StartBatch, Stop, SetSetpoint, TakeSample, "
        "InjectFault en ClearFault. Het commandopad loopt dus bewust niet over MQTT.",
        "<b>Terugvaloptie.</b> Struikelt de ingest van de broker over een "
        "namespace-index, dan neemt een losse connector het over: dezelfde vertaling, "
        "eigen container, achter een profiel dat standaard uit staat.",
    ]))

    a(PageBreak())

    # ---------- 6. MES ----------
    a(P("HOOFDSTUK 6", "kicker"))
    a(P("Wat de fabriek ervan maakt", "h1"))
    a(P("Boven de lijn zit een MES-laag die van metingen een administratie maakt.", "lead"))

    blocks = [
        ("Orders en batches",
         "Een productieorder valt uiteen in batches. De order kent een stopregel: sluiten "
         "kan niet zolang er geen productie op geboekt is. Dat voorkomt de klassieke lege "
         "order die administratief klaar is en fysiek niet."),
        ("De scanstroom op de werkvloer",
         "Poortscan, labelscan, wegen, rapportscan. Pas bij de rapportscan worden de "
         "gewogen hoeveelheden echt geboekt en gaat de voorraad eraf. Elke geweigerde scan "
         "laat een spoor achter met de reden, niet alleen een foutcode."),
        ("Van pack naar pallet",
         "Gevulde packs worden verpakt in een handling unit met een achttiencijferig "
         "label, ingeboekt in het koelmagazijn en daarna verzonden. Het label is nadrukkelijk "
         "een plaatshouder en geen echt geregistreerd GS1-nummer."),
        ("Onderhoud dat vooruitkijkt",
         "De opwarmtijd van de kookketel wordt getrend. Boven de drempel volgt een melding, "
         "na vier batches zonder reiniging springt de ketel op Dirty en weigert nieuw werk. "
         "De weigering legt zichzelf uit en levert meteen de knop om te reinigen."),
        ("Het batchrapport",
         "Het rapport is een elektronisch batchdossier: herkomst, doseringen, "
         "procesgebeurtenissen, alarmen en de handtekening van de operator op het verdict, "
         "in een artefact. Daarnaast een periodiek rapport over de hele fabriek en een "
         "onderhoudsrapport per machine."),
    ]
    for title, text in blocks:
        a(KeepTogether([P(title, "h3"), P(text, "body")]))

    a(P("Kostenmodel", "h2"))
    grondstof = sum(d["qty_kg"] * COST["cost_per_kg_material"].get(d["material_id"], 0)
                    for d in RECIPE["doses"])
    packs = RECIPE["basis_L"] / RECIPE["pack_size_L"]
    crows = [
        ["Opbrengst per pack", f"{nl(COST['value_per_pack'], 2)} EUR"],
        ["Kosten per uur stilstand", f"{nl(COST['cost_per_downtime_hour'])} EUR"],
        ["Kosten herbewerking per batch", f"{nl(COST['rework_cost_per_batch'])} EUR"],
        ["Grondstofkosten per batch", f"{nl(grondstof)} EUR"],
        ["Opbrengst per volle batch", f"{nl(packs * COST['value_per_pack'])} EUR"],
        ["Marge per volle batch", f"{nl(packs * COST['value_per_pack'] - grondstof)} EUR"],
    ]
    rows = [[Paragraph(nodash(r[0]), ST["cell"]), Paragraph(nodash(r[1]), ST["cellb"])] for r in crows]
    a(datatable(["Post", "Waarde"], rows, [CONTENT_W * 0.55, CONTENT_W * 0.45], align_right=(1,)))
    a(Spacer(1, 2 * mm))
    a(P("Hiermee heeft een afgekeurde batch een prijskaartje, en dat is wat een "
        "kwaliteitsbeslissing bespreekbaar maakt buiten de productieafdeling.", "small"))

    a(PageBreak())

    # ---------- 7. KPI ----------
    a(P("HOOFDSTUK 7", "kicker"))
    a(P("Kentallen en hun grenzen", "h1"))
    a(P("Negen kentallen, elk met een doel, een waarschuwing en een kritieke grens.", "lead"))

    KPI_NL = {
        "throughput_rate": "Doorzet",
        "quality_ratio": "Kwaliteitsratio",
        "scrap_ratio": "Uitval",
        "utilization_efficiency": "Bezettingsgraad",
        "plan_attainment_pct": "Planrealisatie",
        "mass_yield_pct": "Massarendement",
        "capability_cpk": "Procescapabiliteit Cpk",
        "oee": "OEE",
        "otif_pct": "Op tijd en compleet",
    }
    def kv(x):
        return nl(x) if abs(x) >= 1000 else nlg(x)

    krows = []
    for k in KPIS:
        richting = "hoger beter" if k["direction"] == "higher_is_better" else "lager beter"
        krows.append([
            Paragraph(nodash(KPI_NL.get(k["kpi_id"], k["kpi_id"])), ST["cellb"]),
            Paragraph(nodash(k["kpi_id"]), ST["monosm"]),
            Paragraph(nodash(str(k.get("unit", ""))), ST["cellm"]),
            Paragraph(kv(k["target"]), ST["cell"]),
            Paragraph(kv(k["warn"]), ST["cell"]),
            Paragraph(kv(k["critical"]), ST["cell"]),
            Paragraph(nodash(richting), ST["cellm"]),
        ])
    a(datatable(["Kental", "Id", "Eenheid", "Doel", "Waarschuwing", "Kritiek", "Richting"], krows,
                [CONTENT_W * 0.18, CONTENT_W * 0.25, CONTENT_W * 0.10, CONTENT_W * 0.09,
                 CONTENT_W * 0.15, CONTENT_W * 0.09, CONTENT_W * 0.14],
                align_right=(3, 4, 5)))

    a(Spacer(1, 3 * mm))
    a(callout("OEE is hier expliciet OEE-light",
              "Beschikbaarheid komt uit de toestandshistorie, prestatie uit de opwarmtrend "
              "van de kookketel tegen zijn schone basislijn, en kwaliteit uit de verhouding "
              "goedgekeurde packs over het totaal. Die laatste is fabrieksbreed en dus voor "
              "elke machine gelijk. Dat is een vereenvoudiging, en die staat er zo bij, want "
              "een kental waarvan niemand de definitie kent is erger dan geen kental."))

    a(P("Kwaliteitsmonsters", "h2"))
    srows = []
    for st_ in MODEL["sample_types"]:
        sp = st_.get("spec", {})
        srows.append([
            Paragraph(nodash(st_["type"]), ST["monosm"]),
            Paragraph(nodash(st_["phase"]), ST["cell"]),
            Paragraph(nodash(st_["location"]), ST["monosm"]),
            Paragraph(f"{sp.get('min','')} tot {sp.get('max','')} {st_.get('unit','')}", ST["cell"]),
            Paragraph("ja" if st_.get("critical") else "nee", ST["cellb"]),
        ])
    a(datatable(["Monstertype", "Fase", "Locatie", "Spec", "Kritiek"], srows,
                [CONTENT_W * 0.22, CONTENT_W * 0.16, CONTENT_W * 0.24,
                 CONTENT_W * 0.24, CONTENT_W * 0.14]))

    a(PageBreak())

    # ---------- 8. schermen ----------
    a(P("HOOFDSTUK 8", "kicker"))
    a(P("De schermen", "h1"))
    a(P("Twaalf schermen, verdeeld over twee rollen die elkaar niet in de weg zitten.", "lead"))

    ops = [
        ("Lijn L1", "/line", "Het procesbeeld van de hele lijn, live."),
        ("Alarmen", "/alarms", "Openstaande meldingen met bevestiging."),
        ("Werkvloer", "/shopfloor", "De scanstroom: poort, label, wegen, rapport."),
        ("SCADA", "/scada", "Bedieningsconsole met de simulatieknoppen."),
    ]
    mgmt = [
        ("Plant", "/", "Fabrieksoverzicht met de kentallen bovenaan."),
        ("Management", "/management", "Het overzicht voor buiten de productie."),
        ("Orders", "/orders", "Productieorders en hun voortgang."),
        ("Batches", "/batches", "Batchlijst met recept en verdict."),
        ("Equipment", "/equipment", "Toestand, draaiuren, onderhoudsmeldingen."),
        ("Voorraad", "/voorraad", "Grondstoffen en gereed product."),
        ("Rapporten", "/reports", "Batchdossier, periode, onderhoud."),
        ("Analyse", "/analyse", "Trends en vergelijkingen."),
    ]
    rows = []
    for lbl, href, desc in ops:
        rows.append([Paragraph("Operatie", ST["cellm"]), Paragraph(nodash(lbl), ST["cellb"]),
                     Paragraph(nodash(href), ST["monosm"]), Paragraph(nodash(desc), ST["cell"])])
    for lbl, href, desc in mgmt:
        rows.append([Paragraph("Beheer", ST["cellm"]), Paragraph(nodash(lbl), ST["cellb"]),
                     Paragraph(nodash(href), ST["monosm"]), Paragraph(nodash(desc), ST["cell"])])
    a(datatable(["Rol", "Scherm", "Pad", "Waarvoor"], rows,
                [CONTENT_W * 0.13, CONTENT_W * 0.19, CONTENT_W * 0.20, CONTENT_W * 0.48]))

    a(P("Twee regels waar niet aan getornd wordt", "h2"))
    a(bullets([
        "Een verouderde waarde krijgt een arceerpatroon, nooit een kleur. Kleur is in een "
        "besturingsscherm gereserveerd voor procestoestand. Wie veroudering met kleur aangeeft, "
        "leert de operator kleuren negeren.",
        "Een ontbrekende waarde is een streepje, nooit een nul. Een nul is een meting en een "
        "streepje is een gat, en dat verschil is precies het verschil tussen een gestopte "
        "pomp en een kapotte sensor.",
    ]))

    a(Spacer(1, 3 * mm))
    a(P("Naast deze schermen draait een aparte Grafana met de trends uit de historian, en de "
        "oorspronkelijke demopagina die de MES-laag rechtstreeks bevraagt. Alleen die twee "
        "staan naar buiten open, achter authenticatie. De bus, het OPC-UA-eindpunt en de "
        "databases blijven intern.", "body"))

    a(PageBreak())

    # ---------- 9. bedienen ----------
    a(P("HOOFDSTUK 9", "kicker"))
    a(P("Zelf aan de knoppen", "h1"))
    a(P("De hele demo in vier handelingen.", "lead"))

    steps_do = [
        ("1. Zet de stack aan",
         "docker compose -f docker-compose.slim.yml \\\n"
         "  -f scenarios/vla-batch/docker-compose.vla.yml up -d --build",
         "Vanuit de idp-os root, met een gevulde .env ernaast. De eenmalige init-container "
         "registreert de fabriek bij de broker en stopt daarna."),
        ("2. Start een batch",
         "curl -s -X POST http://vla-batch-engine:8000/api/v1/batches \\\n"
         "  -H 'content-type: application/json' \\\n"
         "  -d '{\"recipe_id\": \"chocolate-vla-1L\"}'",
         "De MES-laag leidt de doseersetpoints af uit het recept en start de batch. "
         "Ongeveer twee minuten later staat hij op COMPLETE."),
        ("3. Kijk mee op de bus",
         "mosquitto_sub -h monstermq -t 'DairyWorks/Vla/#' -v",
         "Elke meting die de fabriek doet komt hier voorbij, in het vaste payloadformaat."),
        ("4. Breek hem expres",
         "curl -s -X POST http://vla-batch-engine:8000/api/v1/admin/command \\\n"
         "  -d '{\"equipment_id\":\"Batch\",\"cmd\":\"fault\",\n"
         "       \"params\":{\"faultId\":\"cook_undertemp\",\"magnitude\":1.0}}'",
         "De kookketel komt niet op temperatuur, de viscositeit zakt onder 150 cP, het "
         "verdict slaat om naar HOLD en het koelmagazijn weigert de packs. Opheffen met "
         "hetzelfde commando en cmd clear_fault."),
    ]
    for title, cmd, expl in steps_do:
        code = Table([[Paragraph(nodash(cmd).replace("\n", "<br/>").replace(" ", "&nbsp;"),
                                 ST["monosm"])]], colWidths=[CONTENT_W])
        code.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F4F7FA")),
            ("LINEBEFORE", (0, 0), (0, -1), 2, STEEL),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        a(KeepTogether([P(title, "h3"), code, Spacer(1, 2 * mm), P(expl, "body")]))

    a(P("Zelftests, zonder dat er iets draait", "h2"))
    a(P("Beide zelftests werken offline, dus zonder broker, database of fabriek. Dat is een "
        "harde eis in dit project: kun je een wijziging niet op een losse laptop verifieren, "
        "dan verifieer je hem in de praktijk nooit.", "body"))
    a(Paragraph("python factory/selftest.py<br/>python batch-engine/selftest.py", ST["mono"]))

    a(PageBreak())

    # ---------- 10. grenzen ----------
    a(P("HOOFDSTUK 10", "kicker"))
    a(P("Wat er niet in zit", "h1"))
    a(P("Eerlijk zijn over de randen is goedkoper dan erop betrapt worden.", "lead"))

    a(bullets([
        "<b>Een fabriek met een enkele bron.</b> Alles komt uit een OPC-UA-server. Er staan "
        "geen losgekoppelde leveranciersystemen naast, dus de opschoon- en modelleerstap "
        "heeft weinig te doen. Dat is de bekendste beperking van deze opzet.",
        "<b>Geen echte laboratoriummeting.</b> Het vetgehalte bestaat als setpoint zonder "
        "bijbehorende meting. Een doelwaarde zonder gemeten waarde is een onvolledig paar.",
        "<b>De handling unit draagt een plaatshouder.</b> Achttien cijfers in de vorm van een "
        "SSCC, maar zonder geregistreerd bedrijfsvoorvoegsel. Bewust, en het staat er zo bij.",
        "<b>Geen palletiseerder en geen echt magazijnsysteem.</b> De logistiek stopt bij "
        "inboeken en verzenden.",
        "<b>De kentallen zijn vereenvoudigd.</b> Zie de opmerking bij OEE. Bruikbaar om een "
        "gesprek te voeren, niet om een fabriek op af te rekenen.",
    ]))

    a(Spacer(1, 3 * mm))
    a(callout("Anonimisering",
              "DairyWorks is verzonnen. Er staan nergens namen van klanten of leveranciers in, "
              "geen adressen, geen schema's uit bestaande systemen. Het proces is gebouwd op "
              "algemene zuivelkennis. Dat is geen juridische formaliteit maar een "
              "ontwerpbeperking: alles wat hier in komt, kan getoond worden.", "cream"))

    a(P("Bijlage: het koppelvlak van de MES-laag", "h2"))
    api = [
        ("Batches", "GET /batches, POST /batches, GET /batches/{id}, POST /batches/{id}/start, "
                    "POST /batches/{id}/ack-verdict"),
        ("Orders", "GET /orders, POST /orders, GET /orders/{id}, POST /orders/{id}/batches, "
                   "POST /orders/{id}/close"),
        ("Werkvloer", "POST /scan/order, POST /scan/label, POST /scan/weigh, POST /scan/report, "
                      "POST /production"),
        ("Logistiek", "GET /hu, POST /hu, POST /hu/{id}/putaway, POST /hu/{id}/ship"),
        ("Equipment", "GET /equipment, GET /equipment/health, POST /equipment/{id}/cip, GET /oee"),
        ("Monsters", "GET /samples, POST /samples, POST /samples/{id}/reprint-label"),
        ("Rapporten", "GET /report/{batch_id}, GET /report/period, GET /report/equipment/{id}"),
        ("Overig", "GET /health, GET /tags, GET /materials, POST /alarms/{id}/ack, POST /admin/command"),
    ]
    rows = [[Paragraph(nodash(g), ST["cellb"]), Paragraph(nodash(e), ST["monosm"])] for g, e in api]
    a(datatable(["Groep", "Endpoints onder /api/v1"], rows, [CONTENT_W * 0.18, CONTENT_W * 0.82]))
    a(Spacer(1, 4 * mm))
    a(P("Rapporten zijn op te vragen als JSON of als PDF, met de queryparameter format.", "small"))

    return s


if __name__ == "__main__":
    build()
    print(f"geschreven: {OUT}  ({OUT.stat().st_size / 1024:.0f} kB)")
