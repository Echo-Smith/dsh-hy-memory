/**
 * Remove the shell's own section icon from our nav row.
 *
 * Hiding only the `<svg>` left its fixed-width wrapper in the layout, so our
 * glyph started one icon-slot to the right of every other row's icon and the
 * row looked misaligned. This hides the slot itself — the row's direct child
 * that contains the foreign icon — and never a subtree that contains our glyph.
 *
 * Pure over the document it receives, so it is testable.
 *
 * @param doc - a Document-like object with `querySelectorAll`.
 * @param attr - marker attribute that keeps repeated passes idempotent.
 * @returns the elements hidden by this call.
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
      if (typeof svg.closest === 'function' && svg.closest('.hm-navGlyph') !== null) continue
      // Climb to the row's direct child: that is the icon slot whose width the
      // shell reserves. Hide it, not just the glyph inside it.
      let slot = svg
      while (slot.parentElement && slot.parentElement !== row) slot = slot.parentElement
      if (typeof slot.querySelector === 'function' && slot.querySelector('.hm-navGlyph') !== null) continue
      if (typeof slot.getAttribute === 'function' && slot.getAttribute(attr) === '1') continue
      if (typeof slot.setAttribute === 'function') slot.setAttribute(attr, '1')
      if (slot.style !== undefined) slot.style.display = 'none'
      hidden.push(slot)
    }
  }
  return hidden
}
