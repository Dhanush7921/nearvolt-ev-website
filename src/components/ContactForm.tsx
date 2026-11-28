import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useSearchParam } from '../lib/router';
import { leadsMode, newSubmissionId, submitLead, type SubmitResult } from '../lib/leads';
import { Icon } from './Icon';

// V1.2 cinematic contact form. It posts through the EXISTING lead backend (Google Apps Script, form type "general")
// without needing a redeploy: the category and optional phone are carried inside the message text, and the topic
// uses one of the values the script already allow-lists.
export const CATEGORIES = ['Charging Assistance', 'Become a Host', 'Vehicle Compatibility', 'Business Partnership', 'Technical Support', 'Safety Concern', 'General Enquiry'] as const;
type Category = (typeof CATEGORIES)[number];
const TOPIC: Record<Category, string> = {
  'Charging Assistance': 'A question about the app',
  'Become a Host': 'A question about the app',
  'Vehicle Compatibility': 'A question about the app',
  'Technical Support': 'A question about the app',
  'Safety Concern': 'A question about the app',
  'Business Partnership': 'Something else',
  'General Enquiry': 'Something else',
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const COOLDOWN = 60_000;
const PARAM: Record<string, Category> = { safety: 'Safety Concern', host: 'Become a Host', partner: 'Business Partnership', support: 'Technical Support', charging: 'Charging Assistance', vehicle: 'Vehicle Compatibility' };

type Errors = Partial<Record<'name' | 'email' | 'phone' | 'category' | 'message' | 'consent', string>>;

export function ContactForm() {
  const uid = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const preset = PARAM[useSearchParam('category') || ''];
  const [category, setCategory] = useState<Category | ''>(preset || '');
  useEffect(() => {
    if (preset) setCategory(preset);
  }, [preset]);
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [coolUntil, setCoolUntil] = useState(0);
  const [, tick] = useState(0);
  const hp = useRef<HTMLInputElement>(null);
  const sid = useRef(newSubmissionId());
  const live = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!coolUntil) return;
    const t = window.setInterval(() => (Date.now() > coolUntil ? (setCoolUntil(0), window.clearInterval(t)) : tick((n) => n + 1)), 1000);
    return () => window.clearInterval(t);
  }, [coolUntil]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Please enter your name.';
    else if (name.trim().length > 80) e.name = 'Keep this under 80 characters.';
    if (!EMAIL.test(email.trim())) e.email = 'Enter an email address like name@example.com.';
    if (phone.trim() && !PHONE.test(phone.trim().replace(/\s+/g, ' '))) e.phone = 'Enter a 10-digit Indian mobile number, optionally with +91.';
    if (!category) e.category = 'Choose what your message is about.';
    if (message.trim().length < 10) e.message = 'Please write at least a sentence (10+ characters).';
    else if (message.length > 1700) e.message = 'Keep this under 1,700 characters.';
    if (!consent) e.consent = 'Please confirm we may store these details to reply.';
    return e;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || Date.now() < coolUntil) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cf="${uid}"] [aria-invalid="true"], [data-cf="${uid}"] .cf-chips[data-invalid] button`)?.focus());
      return;
    }
    setBusy(true);
    setResult(null);
    const cat = category as Category;
    const body = `Category: ${cat}${phone.trim() ? `\nPhone: ${phone.trim()}` : ''}\n\n${message.trim()}`;
    const res = await submitLead('general', { name: name.trim(), email: email.trim(), topic: TOPIC[cat], message: body, consent: true, website: hp.current?.value || '' }, sid.current);
    setBusy(false);
    setResult(res);
    if (res.status === 'saved') {
      sid.current = newSubmissionId();
      setCoolUntil(Date.now() + COOLDOWN);
    }
    requestAnimationFrame(() => live.current?.focus());
  };

  if (result?.status === 'saved')
    return (
      <div className="cf-done" ref={live} tabIndex={-1} role="status">
        <span className="cf-check" aria-hidden="true">
          <svg viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="24" />
            <path d="M15 27l7 7 15-16" />
          </svg>
        </span>
        <h3 className="h3">Message received.</h3>
        <p className="muted">Your message reached our form service and was stored. We read every message and reply to those that need a reply.</p>
        <button type="button" className="text-link cf-again" onClick={() => setResult(null)} disabled={Date.now() < coolUntil}>
          {Date.now() < coolUntil ? `You can send another in ${Math.ceil((coolUntil - Date.now()) / 1000)} s` : 'Send another message'}
        </button>
      </div>
    );

  const err = (k: keyof Errors) =>
    errors[k] ? (
      <small className="ferr" id={`${uid}-${k}-e`}>
        <Icon name="circle-alert" /> {errors[k]}
      </small>
    ) : null;
  const clear = (k: keyof Errors) => errors[k] && setErrors((x) => ({ ...x, [k]: undefined }));

  return (
    <form className="cf" onSubmit={onSubmit} noValidate data-cf={uid} aria-describedby={`${uid}-note`}>
      <div className="cf-row">
        <label className="afield">
          <span>Full name</span>
          <input value={name} onChange={(e) => (setName(e.target.value), clear('name'))} autoComplete="name" maxLength={80} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${uid}-name-e` : undefined} />
          {err('name')}
        </label>
        <label className="afield">
          <span>Email address</span>
          <input type="email" value={email} onChange={(e) => (setEmail(e.target.value), clear('email'))} autoComplete="email" maxLength={120} aria-invalid={!!errors.email} aria-describedby={errors.email ? `${uid}-email-e` : undefined} />
          {err('email')}
        </label>
      </div>
      <label className="afield">
        <span>
          Phone number <em className="opt">Optional</em>
        </span>
        <input type="tel" value={phone} onChange={(e) => (setPhone(e.target.value), clear('phone'))} autoComplete="tel" placeholder="+91 98765 43210" maxLength={16} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? `${uid}-phone-e` : undefined} />
        {err('phone')}
      </label>
      <fieldset className="cf-cat">
        <legend>Enquiry category</legend>
        <div className="cf-chips" role="radiogroup" aria-label="Enquiry category" data-invalid={errors.category ? true : undefined} aria-describedby={errors.category ? `${uid}-category-e` : undefined}>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} className={`chip${c === 'Safety Concern' ? ' chip-safety' : ''}`} onClick={() => (setCategory(c), clear('category'))}>
              {category === c && <Icon name="check" />}
              {c}
            </button>
          ))}
        </div>
        {err('category')}
      </fieldset>
      {category === 'Safety Concern' && (
        <p className="cf-urgent" role="note">
          <Icon name="triangle-alert" /> If anyone is in danger right now, call <a href="tel:112">112</a>. This form is not monitored for emergencies.
        </p>
      )}
      <label className="afield">
        <span>Message</span>
        <textarea rows={4} value={message} onChange={(e) => (setMessage(e.target.value), clear('message'))} maxLength={1700} aria-invalid={!!errors.message} aria-describedby={errors.message ? `${uid}-message-e` : undefined} placeholder="How can we help?" />
        {err('message')}
      </label>
      <div className="hp" aria-hidden="true">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input ref={hp} id={`${uid}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="cf-consent">
        <input type="checkbox" checked={consent} onChange={(e) => (setConsent(e.target.checked), clear('consent'))} aria-invalid={!!errors.consent} aria-describedby={errors.consent ? `${uid}-consent-e` : undefined} />
        <span>I agree that NEARVOLT EV may store these details to reply to me.</span>
      </label>
      {err('consent')}
      <button type="submit" className="auth-submit cf-submit" disabled={busy || Date.now() < coolUntil}>
        {busy ? (
          <>
            <Icon name="loader-circle" className="icon spin" /> Sending…
          </>
        ) : (
          'Send message'
        )}
      </button>
      <div ref={live} tabIndex={-1} aria-live="polite" className="cf-live">
        {result?.status === 'error' && (
          <p className="cf-msg err">
            <Icon name="circle-alert" /> {result.message}
          </p>
        )}
        {result?.status === 'duplicate' && (
          <p className="cf-msg">
            <Icon name="info" /> We already have this exact message from you in the last day, so it was not sent again.
          </p>
        )}
        {result?.status === 'demo' && (
          <p className="cf-msg warn">
            <Icon name="info" /> Demo mode: the form service is not configured on this build, so nothing was sent or saved.
          </p>
        )}
      </div>
      <p className="cf-note" id={`${uid}-note`}>
        For general support, not roadside or medical emergencies.{leadsMode === 'demo' ? ' This build has no form endpoint configured.' : ''}
      </p>
    </form>
  );
}
