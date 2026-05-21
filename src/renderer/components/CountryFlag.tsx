import React from 'react';
import { getCountryCode } from '@/renderer/utils/countryFlags';
import { Globe } from 'lucide-react';
import {
  AE,
  AR,
  AT,
  AU,
  BE,
  BR,
  CA,
  CH,
  CL,
  CN,
  CO,
  CZ,
  DE,
  DK,
  EE,
  EG,
  ES,
  FI,
  FR,
  GB,
  GR,
  HK,
  HU,
  ID,
  IE,
  IL,
  IN,
  IT,
  JP,
  KR,
  LT,
  LV,
  MX,
  MY,
  NL,
  NO,
  NZ,
  PH,
  PL,
  PT,
  RO,
  RU,
  SA,
  SE,
  SG,
  TH,
  TR,
  TW,
  UA,
  US,
  VN,
  ZA,
} from 'country-flag-icons/react/3x2';

interface CountryFlagProps {
  server: { name: string; address: string };
  className?: string;
  size?: number;
}

type FlagComponent = typeof US;

const flagRegistry: Record<string, FlagComponent> = {
  AE,
  AR,
  AT,
  AU,
  BE,
  BR,
  CA,
  CH,
  CL,
  CN,
  CO,
  CZ,
  DE,
  DK,
  EE,
  EG,
  ES,
  FI,
  FR,
  GB,
  GR,
  HK,
  HU,
  ID,
  IE,
  IL,
  IN,
  IT,
  JP,
  KR,
  LT,
  LV,
  MX,
  MY,
  NL,
  NO,
  NZ,
  PH,
  PL,
  PT,
  RO,
  RU,
  SA,
  SE,
  SG,
  TH,
  TR,
  TW,
  UA,
  US,
  VN,
  ZA,
};

export const CountryFlag = React.memo<CountryFlagProps>(
  ({ server, className = '', size = 24 }) => {
    const countryCode = getCountryCode(server);

    if (!countryCode) {
      // Fallback to globe icon if country cannot be determined
      return (
        <Globe className={className} style={{ width: size, height: size }} />
      );
    }

    const FlagComponent = flagRegistry[countryCode];

    if (!FlagComponent) {
      // Fallback to globe icon if flag component doesn't exist
      return (
        <Globe className={className} style={{ width: size, height: size }} />
      );
    }

    return (
      <FlagComponent
        className={className}
        style={{
          width: `${size}px`,
          height: `${(size * 2) / 3}px`, // Maintain 3:2 aspect ratio
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
    );
  },
);

CountryFlag.displayName = 'CountryFlag';
