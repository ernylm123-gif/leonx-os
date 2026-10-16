"""
DXF → PDF önizleme (ezdxf çizim eklentisi + matplotlib, ikisi de izin verici lisanslı).

Her sayfa ayrı çizilir: model uzayı ve her kâğıt uzayı layout'u. Layout'ların kâğıt boyutu
çizimdeki sayfa ayarından alınır; model uzayı A3 yatay sayfaya sığdırılır. Bu bir önizlemedir:
yazı tipleri (SHX/TTF) birebir olmayabilir, ölçek sayfaya sığdırma ölçeğidir — ölçü almak için
DXF/özgün çizim kullanılır. Rapor her sayfanın boyutunu ve çizilen nesne sayısını verir.
"""
from __future__ import annotations

import io
from dataclasses import asdict, dataclass

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402
from ezdxf import recover  # noqa: E402
from ezdxf.addons.drawing import Frontend, RenderContext  # noqa: E402
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration  # noqa: E402
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend  # noqa: E402

MAX_RENDER_ENTITIES = 300_000
A3 = (420.0, 297.0)
MM_PER_INCH = 25.4


@dataclass
class PdfPage:
    name: str
    width_mm: float
    height_mm: float
    entities: int
    scale_note: str


@dataclass
class PdfResult:
    pdf: bytes
    pages: list[PdfPage]
    skipped: list[str]

    def report(self):
        return {'pages': [asdict(p) for p in self.pages], 'skipped': self.skipped}


def render_pdf(dxf: bytes, include_model: bool = True, max_layouts: int = 20) -> PdfResult:
    doc, _ = recover.read(io.BytesIO(dxf))
    cfg = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.BLACK)
    pages: list[PdfPage] = []
    skipped: list[str] = []
    buf = io.BytesIO()
    layouts = []
    if include_model:
        layouts.append(doc.modelspace())
    layouts.extend(l for l in doc.layouts if l.name != 'Model')
    with PdfPages(buf, metadata={'Creator': 'LEONX OS CAD dönüştürücü', 'Title': 'Çizim önizlemesi'}) as pdf:
        for layout in layouts[: max_layouts + 1]:
            n = len(layout)
            if n == 0:
                skipped.append(f'{layout.name}: boş')
                continue
            if n > MAX_RENDER_ENTITIES:
                skipped.append(f'{layout.name}: {n} nesne (önizleme sınırı {MAX_RENDER_ENTITIES})')
                continue
            w, h = A3
            note = 'sayfaya sığdırıldı (ölçeksiz önizleme)'
            if layout.name != 'Model':
                pw, ph = float(layout.dxf.get('paper_width', 0) or 0), float(layout.dxf.get('paper_height', 0) or 0)
                if pw > 50 and ph > 50:
                    w, h = (pw, ph) if pw >= ph else (ph, pw)
                    note = 'layout kâğıt boyutu'
            fig = plt.figure(figsize=(w / MM_PER_INCH, h / MM_PER_INCH))
            ax = fig.add_axes((0, 0, 1, 1))
            ctx = RenderContext(doc)
            Frontend(ctx, MatplotlibBackend(ax), config=cfg).draw_layout(layout, finalize=True)
            pdf.savefig(fig)
            plt.close(fig)
            pages.append(PdfPage(name=layout.name, width_mm=round(w, 1), height_mm=round(h, 1), entities=n, scale_note=note))
    return PdfResult(pdf=buf.getvalue() if pages else b'', pages=pages, skipped=skipped)
