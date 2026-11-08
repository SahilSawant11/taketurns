/**
 * The multi-step forms (project inquiry, vendor registration): one step per
 * fieldset[data-step], validated before moving on, a review of everything as
 * the last step, the draft kept on this device. Sent through submitInquiry();
 * until that has an endpoint, the visitor gets it written out in their own
 * email, addressed to us.
 *
 * Read from the root [data-iq] element:
 *   data-key      localStorage key for the draft
 *   data-email    our address, for the email fallback
 *   data-subject  the email's subject, e.g. "Project inquiry"
 *   data-noun     what it is in messages, e.g. "inquiry"
 * Fields: a checkbox group (several boxes, one name) is required when its
 * .choices has data-required. data-review-label names a field in the review.
 * URL parameters fill fields of the same name (?type= fills requestType).
 */
import { submitInquiry } from './submitInquiry';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const ALIASES: Record<string, string> = { type: 'requestType' };

export function initStepForm(root: HTMLElement) {
  const KEY = root.dataset.key ?? 'form-draft';
  const noun = root.dataset.noun ?? 'inquiry';
  const form = root.querySelector('form')!;
  const sets = [...form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]')];
  const inds = [...root.querySelectorAll<HTMLLIElement>('[data-step-ind]')];
  const back = form.querySelector<HTMLButtonElement>('[data-back]')!;
  const next = form.querySelector<HTMLButtonElement>('[data-next]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitText = submit.textContent;
  const err = form.querySelector<HTMLElement>('.iq__err')!;
  const status = form.querySelector<HTMLElement>('.iq__status')!;
  const saved = form.querySelector<HTMLElement>('.iq__saved')!;
  let step = 0;

  const group = (el: Element) => {
    const i = el as HTMLInputElement;
    return i.type === 'checkbox' && form.querySelectorAll(`[name="${i.name}"]`).length > 1;
  };
  const labelFor = (el: Element) => {
    const own = (el as HTMLElement).dataset.reviewLabel;
    if (own) return own;
    const lab = el.closest('label.fld, .fld');
    const head = lab?.querySelector(':scope > span[id]');
    // a group's heading: its own words, without the "*" and hint spans
    const words = head && [...head.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
    return (words || lab?.childNodes[0]?.textContent || (el as HTMLInputElement).name).replace('*', '').trim();
  };

  /** Every field's value; a checkbox group's ticked values joined. */
  const data = () => {
    const out: Record<string, string> = {};
    new FormData(form).forEach((v, k) => {
      out[k] = out[k] ? `${out[k]}, ${v}` : String(v);
    });
    return out;
  };

  const fill = (name: string, value: string) => {
    form.querySelectorAll<HTMLInputElement>(`[name="${name}"]`).forEach((el) => {
      if (el.type === 'radio') el.checked = el.value === value;
      else if (el.type === 'checkbox') el.checked = value.split(', ').includes(el.value);
      else el.value = value;
    });
  };
  // Restore the draft, then let URL parameters fill in.
  try {
    Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}')).forEach(([k, v]) => fill(k, String(v)));
  } catch {}
  new URLSearchParams(location.search).forEach((v, k) => {
    const name = ALIASES[k] ?? k;
    if (form.querySelector(`[name="${name}"]`)) fill(name, v);
  });

  let saveTimer: number | undefined;
  form.addEventListener('input', (e) => {
    const el = e.target as Field;
    if (el.getAttribute('aria-invalid') === 'true' || group(el)) clearError(el);
    try {
      localStorage.setItem(KEY, JSON.stringify(data()));
    } catch {
      return;
    }
    saved.classList.add('is-on');
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saved.classList.remove('is-on'), 1400);
  });

  function clearError(el: Element) {
    const targets = group(el) ? form.querySelectorAll(`[name="${(el as HTMLInputElement).name}"]`) : [el];
    targets.forEach((t) => {
      t.removeAttribute('aria-invalid');
      const id = t.getAttribute('aria-describedby');
      if (id) {
        document.getElementById(id)?.remove();
        t.removeAttribute('aria-describedby');
      }
    });
  }

  function validate(i: number) {
    const fs = sets[i];
    const fields = [...fs.querySelectorAll<Field>('input, select, textarea')];
    const bad: { el: Field; msg: string; host: Element }[] = [];
    const seen = new Set<string>();
    fields.forEach((el) => {
      clearError(el);
      const inp = el as HTMLInputElement;
      if (inp.type === 'radio' || group(inp)) {
        if (seen.has(inp.name)) return;
        seen.add(inp.name);
        const box = inp.closest('.choices')!;
        const need = inp.type === 'radio' ? inp.required : box.hasAttribute('data-required');
        if (need && !fs.querySelector(`[name="${inp.name}"]:checked`))
          bad.push({ el, msg: inp.type === 'radio' ? 'Choose one option.' : 'Choose at least one.', host: box });
        return;
      }
      if (inp.type === 'checkbox') {
        if (inp.required && !inp.checked) bad.push({ el, msg: 'Please confirm to continue.', host: inp.closest('label')! });
        return;
      }
      el.value = el.value.trim();
      if (el.required && !el.value) bad.push({ el, msg: `${labelFor(el)} is required.`, host: el });
      else if (inp.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value))
        bad.push({ el, msg: 'Enter a valid email address, like name@company.com.', host: el });
      else if (inp.type === 'url' && el.value && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/.test(el.value))
        bad.push({ el, msg: 'Enter a link, like company.com/catalogue.pdf.', host: el });
    });
    bad.forEach(({ el, msg, host }, n) => {
      const id = `err-${el.name}`;
      const p = document.createElement('p');
      p.className = 'field-err';
      p.id = id;
      p.textContent = msg;
      host.insertAdjacentElement('afterend', p);
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', id);
      if (n === 0) el.focus();
    });
    err.hidden = bad.length === 0;
    err.textContent = bad.length ? `Please fix ${bad.length === 1 ? 'one field' : `${bad.length} fields`} before continuing.` : '';
    return bad.length === 0;
  }

  function buildReview() {
    const dl = form.querySelector<HTMLDListElement>('[data-review]')!;
    dl.replaceChildren();
    sets.slice(0, -1).forEach((fs, i) => {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit';
      edit.innerHTML = `${fs.querySelector('legend')!.textContent}<span>Edit</span>`;
      edit.addEventListener('click', () => go(i));
      dl.append(edit);
      const seen = new Set<string>();
      fs.querySelectorAll<Field>('input, select, textarea').forEach((el) => {
        if (seen.has(el.name)) return;
        seen.add(el.name);
        const inp = el as HTMLInputElement;
        let v = '';
        if (inp.type === 'radio') v = (fs.querySelector<HTMLInputElement>(`[name="${el.name}"]:checked`)?.parentElement?.textContent ?? '').trim();
        else if (group(inp))
          v = [...fs.querySelectorAll<HTMLInputElement>(`[name="${el.name}"]:checked`)].map((c) => c.parentElement!.textContent!.trim()).join(', ');
        else if (inp.type === 'checkbox') v = inp.checked ? 'Yes' : '';
        else if (el instanceof HTMLSelectElement) v = el.value ? el.selectedOptions[0].textContent!.trim() : '';
        else v = el.value.trim();
        if (!v) return;
        const dt = document.createElement('dt');
        dt.textContent = labelFor(group(inp) ? inp.closest('.fld')!.querySelector('span[id]') ?? el : el);
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      });
    });
  }

  function go(i: number) {
    step = i;
    sets.forEach((fs, n) => (fs.hidden = n !== i));
    inds.forEach((li, n) => {
      if (n === i) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', n < i);
    });
    back.hidden = i === 0;
    next.hidden = i === sets.length - 1;
    submit.hidden = i !== sets.length - 1;
    err.hidden = true;
    if (i === sets.length - 1) buildReview();
    status.textContent = `Step ${i + 1} of ${sets.length}: ${inds[i].textContent?.trim()}`;
    sets[i].querySelector('legend')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    sets[i].querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true });
  }

  next.addEventListener('click', () => {
    if (validate(step)) go(step + 1);
  });
  back.addEventListener('click', () => go(step - 1));

  // Reuses the review list so the copied text has the same human-readable labels.
  const asText = () =>
    [...form.querySelectorAll('[data-review] dt')].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`).join('\n');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(step)) return;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    const d = data();
    const res = await submitInquiry(d);
    submit.disabled = false;
    submit.textContent = submitText;
    if (res.status === 'error') {
      err.hidden = false;
      err.textContent = `Your ${noun} wasn't sent. ${res.message} Your answers are still here.`;
      return;
    }
    form.hidden = true;
    root.querySelector<HTMLElement>('.iq__steps')!.hidden = true;
    const done = root.querySelector<HTMLElement>(`[data-done="${res.status}"]`)!;
    done.hidden = false;
    done.focus();
    if (res.status === 'sent') {
      try {
        localStorage.removeItem(KEY);
      } catch {}
      return;
    }
    const text = asText();
    root.querySelector('[data-copy-text]')!.textContent = text;
    // written out in the visitor's own email, ready to send to us
    const to = root.dataset.email;
    const mail = root.querySelector<HTMLAnchorElement>('[data-mailto]');
    if (to && mail) {
      const who = d.company || d.name || '';
      const subject = `${root.dataset.subject ?? 'Inquiry'}${who ? ` from ${who}` : ''}`;
      mail.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    }
  });

  root.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(root.querySelector('[data-copy-text]')!.textContent ?? '');
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Select the text above to copy';
    }
  });
  root.querySelector('[data-edit]')?.addEventListener('click', () => {
    root.querySelector<HTMLElement>('[data-done="not-configured"]')!.hidden = true;
    form.hidden = false;
    root.querySelector<HTMLElement>('.iq__steps')!.hidden = false;
    go(sets.length - 1);
  });
}
