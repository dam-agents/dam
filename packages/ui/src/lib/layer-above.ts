const LAYER_ABOVE_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"]';

export const layerAbove = () =>
  document.querySelector(LAYER_ABOVE_SELECTOR) !== null;
