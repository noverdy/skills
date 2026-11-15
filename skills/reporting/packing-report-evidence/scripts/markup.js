window.evidenceMark = function evidenceMark(spec) {
  const result = { boxed: 0, blurred: 0, hidden: 0, missing: [] };
  const colors = { red: "#e5484d", green: "#30a46c", amber: "#ffb224", blue: "#3e63dd" };
  const style = document.createElement("style");
  style.textContent = [
    ".ev-box{outline:2px solid var(--ev-c,#e5484d);outline-offset:2px;border-radius:3px}",
    ".ev-blur{filter:blur(4px);user-select:none}",
    ".ev-keep{color:#30a46c !important;font-weight:600}",
  ].join("");
  document.head.appendChild(style);

  const textNodes = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !n.parentElement.closest("script,style,.ev-blur,.ev-keep") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const out = [];
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  };

  const scramble = (s) => {
    const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let r = "";
    for (const ch of s) r += /\s/.test(ch) ? ch : pool[Math.floor(Math.random() * pool.length)];
    return r;
  };

  const eachMatch = (pattern, wrap) => {
    const re = new RegExp(pattern, "g");
    let count = 0;
    for (const node of textNodes()) {
      const text = node.nodeValue;
      re.lastIndex = 0;
      const hits = [...text.matchAll(re)].filter((m) => m[0].length);
      if (!hits.length) continue;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const m of hits) {
        const g = m.length > 1 && m[1] !== undefined ? m[1] : m[0];
        const start = m.index + (g === m[0] ? 0 : m[0].indexOf(g));
        frag.append(text.slice(at, start), wrap(g));
        at = start + g.length;
        count++;
      }
      frag.append(text.slice(at));
      node.replaceWith(frag);
    }
    return count;
  };

  const boxEl = (el, color) => {
    el.classList.add("ev-box");
    el.style.setProperty("--ev-c", colors[color] || color || colors.red);
  };

  for (const sel of spec.hide || []) {
    const els = document.querySelectorAll(sel);
    if (!els.length) result.missing.push({ hide: sel });
    els.forEach((el) => el.remove());
    result.hidden += els.length;
  }

  for (const b of spec.blur || []) {
    const keep = b.keep ?? 4;
    const wrap = (secret) => {
      const span = document.createElement("span");
      if (b.box) boxEl(span, b.box === true ? "red" : b.box);
      const shown = secret.length >= 12 ? keep : 0;
      const hidden = document.createElement("span");
      hidden.className = "ev-blur";
      hidden.textContent = scramble(secret.slice(0, secret.length - shown));
      span.append(hidden);
      if (shown) {
        const tail = document.createElement("span");
        tail.className = "ev-keep";
        tail.textContent = secret.slice(-shown);
        span.append(tail);
      }
      return span;
    };
    let n = 0;
    if (b.selector) {
      document.querySelectorAll(b.selector).forEach((el) => {
        el.replaceChildren(wrap(el.textContent));
        n++;
      });
    } else {
      n = eachMatch(b.match, wrap);
    }
    if (!n) result.missing.push({ blur: b.match || b.selector });
    result.blurred += n;
  }

  for (const b of spec.box || []) {
    let n = 0;
    if (b.selector) {
      document.querySelectorAll(b.selector).forEach((el) => {
        boxEl(el, b.color);
        n++;
      });
    } else {
      n = eachMatch(b.match, (s) => {
        const span = document.createElement("span");
        span.textContent = s;
        boxEl(span, b.color);
        return span;
      });
    }
    if (!n) result.missing.push({ box: b.match || b.selector });
    result.boxed += n;
  }

  return result;
};
