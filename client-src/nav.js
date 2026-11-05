/**
 * Hide the shell's own section icon beside our nav label.
 *
 * The settings section list renders a default icon before a section's label
 * node. Hiding it from CSS needs the shell's exact wrapper shape, and that shape
 * changed once already (leaving a gear next to the brain). This walk only needs
 * `closest` and `querySelectorAll`, both long-standing DOM APIs, so it survives
 * markup changes. Pure over the document it is given, so it is testable.
 *
 * @param doc - a Document-like object with querySelectorAll`.
 * @param attr - the marker attribute used so a second pass stays idempotent.
 * @returns the svg elements hidden by this call.
 */
export function hideForeignNavIcons(doc, attr) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return []
  const hidden = []
  for (const label of doc.querySelectorAll('.hm-navLabel')) {
    const row = typeof label.closest === 'function'
      ? label.closest('button, a, [role="menuitem"], li')
      : null
    if (!row || typeof row.querySelectorAll !== 'function') continue
    for (const svg of row.querySelectorAll('svg')) {
      // Our own glyph lives inside `.hm-navGlyph`; the class used to sit on the
      // svg itself, which failed when the icon component ignored it.
      const owned = typeof svg.closest === 'function' && svg.closest('.hm-navGlyph') !== null
      if (owned) continue
      if (typeof svg.getAttribute === 'function' && svg.getAttribute(attr) === '1') continue
      if (typeof svg.setAttribute === 'function') svg.setAttribute(attr, '1')
      if (svg.style !== undefined) svg.style.display = 'none'
      hidden.push(svg)
    }
  }
  return hidden
}
