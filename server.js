// server.js (CommonJS)
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({
  path: process.env.DOTENV_PATH || path.join(__dirname, ".env"),
});

const app = express();
app.use(cors());
app.use(express.json());

// Sirve /public
const publicDir = process.env.PUBLIC_DIR || path.join(__dirname, "public");
app.use(express.static(publicDir));

// --- Config Bsale ---
const BSALE_API = process.env.BSALE_API || "https://api.bsale.io/v1";
const headers = { "access_token": process.env.BSALE_TOKEN };
const DEFAULT_PRICE_LIST_ID = process.env.BSALE_PRICE_LIST_ID || "";

// No cache
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
});

async function getPriceFromList(priceListId, { barcode, code, variantId }) {
  if (!priceListId) return null;
  const tries = [];
  if (barcode) tries.push(["barcode", barcode]);
  if (code) tries.push(["code", code]);
  if (variantId) tries.push(["variantid", String(variantId)]);

  for (const [k, v] of tries) {
    const url = `${BSALE_API}/price_lists/${priceListId}/details.json?${k}=${encodeURIComponent(v)}&limit=1`;
    const r = await fetch(url, { headers });
    if (!r.ok) continue;
    let data = null;
    try { data = await r.json(); } catch {}
    const det = data?.items?.[0];
    if (det) return det.variantValueWithTaxes ?? det.variantValue ?? null;
  }
  return null;
}

app.get("/api/lookup", async (req, res) => {
  try {
    const barcode = (req.query.barcode || "").trim();
    const paramPriceListId = (req.query.priceListId || "").trim();
    if (!barcode) return res.status(400).json({ error: "Falta 'barcode'" });

    const vUrl = `${BSALE_API}/variants.json?barcode=${encodeURIComponent(barcode)}&fields=[id,barCode,code,product,stock,price]`;
    const vResp = await fetch(vUrl, { headers });
    if (!vResp.ok) return res.status(500).json({ error: "Error al consultar variantes" });
    const vData = await vResp.json();
    const item = vData?.items?.[0];
    if (!item) return res.status(404).json({ error: "Producto no encontrado" });

    const variantId = item.id;
    const sku = item.code;
    const barCode = item.barCode;
    const productId = item.product?.id;

    let name = "Producto";
    if (productId) {
      const pUrl = `${BSALE_API}/products/${productId}.json?fields=[name]`;
      const pResp = await fetch(pUrl, { headers });
      if (pResp.ok) {
        const pData = await pResp.json();
        name = pData?.name || name;
      }
    }

    let stockTotal = null;
    if (typeof item.stock === "number") {
      stockTotal = item.stock;
    } else {
      const oneVUrl = `${BSALE_API}/variants/${variantId}.json?fields=[stock]`;
      const oneV = await fetch(oneVUrl, { headers });
      if (oneV.ok) {
        const one = await oneV.json();
        if (typeof one.stock === "number") stockTotal = one.stock;
      }
    }

    const priceListId = paramPriceListId || DEFAULT_PRICE_LIST_ID || null;
    let price = null;

    if (priceListId) {
      price = await getPriceFromList(priceListId, { barcode, code: sku, variantId });
    }
    if (price === null) {
      if (typeof item.price !== "undefined" && item.price !== null) {
        price = item.price;
      } else {
        const oneVUrl = `${BSALE_API}/variants/${variantId}.json?fields=[price]`;
        const oneV = await fetch(oneVUrl, { headers });
        if (oneV.ok) {
          const one = await oneV.json();
          if (typeof one.price !== "undefined" && one.price !== null) price = one.price;
        }
      }
    }

    return res.json({ name, sku, barcode: barCode, stockTotal, price, priceListId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Totem Bsale listo en http://localhost:${port}`);
});
