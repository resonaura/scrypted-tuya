import { createContext, useContext, ReactNode } from 'react';
import { Icon, IconifyIconProps } from '@iconify-icon/react';
import {
  MaterialSymbolBase,
} from '../material-symbols';
import json from '@iconify-json/material-symbols/icons.json'; // Runtime icon set

export interface IMaterialIcon extends Omit<IconifyIconProps, 'ref' | 'icon'> {
  icon: MaterialSymbolBase;
  size?: number;
  width?: number;
  height?: number;
  filled?: boolean;
  rounded?: boolean;
}

interface IconContextValue {
  size: number;
}

const IconContext = createContext<IconContextValue>({ size: 20 });
export const useIconContext = () => useContext(IconContext);

export function IconProvider({
  size = 20,
  children,
}: {
  size?: number;
  children: ReactNode;
}) {
  return (
    <IconContext.Provider value={{ size }}>{children}</IconContext.Provider>
  );
}

export function MaterialIcon({
  icon,
  size,
  width,
  height,
  filled,
  rounded = true,
  ...rest
}: IMaterialIcon) {
  const context = useIconContext();
  const finalSize = size ?? context.size ?? 20;

  const pack = 'material-symbols';

  // Build candidate icon names in priority order
  const candidates: string[] = [];

  if (filled) {
    // Filled variants
    if (rounded) candidates.push(`${pack}:${icon}-rounded`);
    candidates.push(`${pack}:${icon}`);
  } else {
    // Outline variants
    if (rounded) candidates.push(`${pack}:${icon}-outline-rounded`);
    candidates.push(`${pack}:${icon}-outline`);
  }

  // If not explicitly set, try candidates in preference order
  if (filled === undefined) {
    candidates.push(
      `${pack}:${icon}-outline-rounded`,
      `${pack}:${icon}-outline`,
      `${pack}:${icon}-rounded`,
      `${pack}:${icon}`
    );
  }

  // Pick the first existing icon
  const found = candidates.find(c => (json as any).icons[c.split(':')[1]]);
  const finalIcon = found ?? `${pack}:${icon}`; // fallback

  return (
    <Icon
      icon={finalIcon}
      width={width ?? finalSize}
      height={height ?? finalSize}
      {...rest}
    />
  );
}
