import React from 'react';
import { getCountryCode } from '../utils/countryFlags';
import { Globe } from 'lucide-react';
import * as Flags from 'country-flag-icons/react/3x2';

interface CountryFlagProps {
  server: { name: string; address: string };
  className?: string;
  size?: number;
}

export const CountryFlag: React.FC<CountryFlagProps> = ({ server, className = '', size = 24 }) => {
  const countryCode = getCountryCode(server);
  
  if (!countryCode) {
    // Fallback to globe icon if country cannot be determined
    return <Globe className={className} style={{ width: size, height: size }} />;
  }
  
  // Get the flag component dynamically
  const FlagComponent = (Flags as any)[countryCode] as React.ComponentType<React.SVGProps<SVGSVGElement>>;
  
  if (!FlagComponent) {
    // Fallback to globe icon if flag component doesn't exist
    return <Globe className={className} style={{ width: size, height: size }} />;
  }
  
  return (
    <FlagComponent 
      className={className}
      style={{ 
        width: `${size}px`, 
        height: `${size * 2 / 3}px`, // Maintain 3:2 aspect ratio
        display: 'inline-block',
        flexShrink: 0
      }}
    />
  );
};

