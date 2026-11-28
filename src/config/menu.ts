// V1.2 navigation: one shared morphing dropdown. Every link points at a page or section that exists on this site.
import type { IconName } from '../components/Icon';

export type MenuLink = { to: string; label: string; text: string; icon: IconName; preview?: PreviewKind };
export type PreviewKind = 'find' | 'emergency' | 'steps' | 'connectors';
export type MenuGroup = { id: string; label: string; layout: 'preview' | 'list'; links: MenuLink[]; footer?: { to: string; label: string } };

export const MENU: MenuGroup[] = [
  {
    id: 'discover',
    label: 'Discover',
    layout: 'preview',
    links: [
      { to: '/#find', label: 'Find charging', text: 'Check whether NEARVOLT EV serves where you are.', icon: 'locate-fixed', preview: 'find' },
      { to: '/#emergency', label: 'Emergency assistance', text: 'What the app can, and cannot, do when the battery is low.', icon: 'life-buoy', preview: 'emergency' },
      { to: '/how-it-works', label: 'How it works', text: 'Request, accept, verify, charge — four clear steps.', icon: 'route', preview: 'steps' },
      { to: '/drivers#compat-title', label: 'Vehicle compatibility', text: 'Connectors and power levels for cars and two-wheelers.', icon: 'plug-zap', preview: 'connectors' },
    ],
  },
  {
    id: 'drivers',
    label: 'Drivers',
    layout: 'list',
    links: [
      { to: '/#find', label: 'Find compatible charging', text: 'Vehicle, connector and battery in one panel.', icon: 'search' },
      { to: '/how-it-works', label: 'Charging request workflow', text: 'From request to completed session.', icon: 'list-checks' },
      { to: '/dashboard#activity', label: 'Charging history', text: 'Preview of the in-app activity view.', icon: 'activity' },
      { to: '/safety', label: 'Driver safety', text: 'Principles that protect every session.', icon: 'shield-check' },
    ],
    footer: { to: '/drivers', label: 'Everything for drivers' },
  },
  {
    id: 'hosts',
    label: 'Hosts',
    layout: 'list',
    links: [
      { to: '/contact?form=host', label: 'Become a host', text: 'Register interest — not a commitment.', icon: 'house' },
      { to: '/hosts#ready-title', label: 'Host requirements', text: 'A quick self-check for your place.', icon: 'clipboard-check' },
      { to: '/hosts#journey-title', label: 'Verification process', text: 'Five steps, with you in control.', icon: 'badge-check' },
      { to: '/safety#equipment', label: 'Host responsibilities', text: 'Suitable equipment and safe parking.', icon: 'wrench' },
    ],
    footer: { to: '/hosts', label: 'Everything for hosts' },
  },
  {
    id: 'safety',
    label: 'Safety',
    layout: 'list',
    links: [
      { to: '/safety#equipment', label: 'Electrical safety', text: 'Equipment and protection we look for.', icon: 'zap' },
      { to: '/#trust', label: 'Verified hosts', text: 'How a host is reviewed before listing.', icon: 'user-check' },
      { to: '/#session', label: 'Session verification', text: 'Arrival check and a private session PIN.', icon: 'key-round' },
      { to: '/safety#privacy', label: 'Privacy protection', text: 'Addresses stay private until acceptance.', icon: 'eye-off' },
    ],
    footer: { to: '/safety', label: 'Safety and trust' },
  },
  {
    id: 'about',
    label: 'About',
    layout: 'list',
    links: [
      { to: '/#story', label: 'Our concept', text: 'Emergency charging, closer to home.', icon: 'lightbulb' },
      { to: '/faq', label: 'FAQ', text: 'Straight answers about the platform.', icon: 'info' },
      { to: '/legal', label: 'Legal & credits', text: 'Pre-launch notice and licences.', icon: 'file-text' },
    ],
  },
];

export const CONTACT_LINK = { to: '/contact', label: 'Contact' };
