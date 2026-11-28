import { useRef } from 'react';
import { useMotion } from '../motion/kinetic';
import { AppPreview } from '../sections/home/AppPreview';
import { Benefits } from '../sections/home/Benefits';
import { Cinema } from '../sections/home/Cinema';
import { Features } from '../sections/home/Features';
import { FindCharging } from '../sections/home/FindCharging';
import { StoreSection } from '../sections/home/StoreSection';
import { TrustSection } from '../sections/home/TrustSection';

export function Home() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(ref);
  return (
    <div className="page page-home" ref={ref}>
      <Cinema />
      <FindCharging />
      <Features />
      <Benefits />
      <TrustSection />
      <AppPreview />
      <StoreSection />
    </div>
  );
}
