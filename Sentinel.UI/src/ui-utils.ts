export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export const inputClasses = {
  base: 'sentinel-input',
  centered: 'sentinel-input text-center',
  subtle: 'sentinel-input sentinel-input--subtle',
  search: 'sentinel-input sentinel-input--search',
};

export const buttonClasses = {
  primary: 'sentinel-button sentinel-button--primary',
  secondary: 'sentinel-button sentinel-button--secondary',
  ghost: 'sentinel-button sentinel-button--ghost',
  danger: 'sentinel-button sentinel-button--danger',
  compact: 'sentinel-button sentinel-button--compact',
  inline: 'sentinel-inline-button',
  chip: 'sentinel-chip',
  pill: 'sentinel-pill-button',
  icon: 'sentinel-icon-button',
};
