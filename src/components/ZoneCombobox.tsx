import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Globe } from '@phosphor-icons/react';
import { tzLabel } from '../lib/time';
import { CITY_LOOKUP_HOST, lookupCity, refreshZonesIfStale, searchZones, type ZoneOption } from '../lib/zones';

interface Props {
  id: string;
  /** null = nothing chosen yet: the field is empty and shows the placeholder. */
  value: string | null;
  onChange: (zone: string) => void;
  placeholder?: string;
}

/**
 * Type a city or a zone ("sao paulo", "EST", "pacific", "gmt-3") and pick from the matches.
 * Liberal in what it accepts: leaving the field after typing picks the best match.
 */
export function ZoneCombobox({ id, value, onChange, placeholder = 'City or time zone' }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null); // null = showing the chosen zone
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    void refreshZonesIfStale();
  }, []);

  const local = useMemo(() => searchZones(query ?? ''), [query]);

  // Nothing local matched: look the city up online (after a short pause, one request at a time).
  const [remote, setRemote] = useState<{ q: string; options: ZoneOption[] } | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'failed'>('idle');
  const typed = (query ?? '').trim();
  useEffect(() => {
    if (!open || local.length > 0 || typed.length < 3) {
      setLookup('idle');
      return;
    }
    const ctl = new AbortController();
    setLookup('loading');
    const timer = setTimeout(() => {
      lookupCity(typed, ctl.signal)
        .then((options) => {
          setRemote({ q: typed, options });
          setLookup('idle');
        })
        .catch((e) => {
          if (!ctl.signal.aborted && !(e instanceof DOMException && e.name === 'AbortError')) setLookup('failed');
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [typed, local.length, open]);

  const options = local.length > 0 ? local : remote && remote.q === typed ? remote.options : [];
  const searchingOnline = local.length === 0 && typed.length >= 3;
  const shown = query ?? (value ? tzLabel(value) : '');

  function choose(tz: string) {
    setQuery(null);
    setOpen(false);
    if (tz !== value) onChange(tz);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault();
        choose(options[active].tz);
      }
    } else if (e.key === 'Escape') {
      setQuery(null);
      setOpen(false);
    }
  }

  function onBlur() {
    // typed something and moved on: take the best match rather than throwing the text away
    if (query && query.trim() && options[0]) choose(options[0].tz);
    else {
      setQuery(null);
      setOpen(false);
    }
  }

  return (
    <div className="combo">
      <Globe className="combo-icon" size={18} aria-hidden />
      <input
        ref={inputRef}
        id={id}
        className="input combo-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={shown}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {options.length === 0 ? (
            <li className="combo-empty">
              {typed.length < 3
                ? 'No match'
                : lookup === 'loading'
                  ? 'Searching cities...'
                  : lookup === 'failed'
                    ? 'No match, and the city search is not reachable right now.'
                    : 'No match'}
            </li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.tz}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.tz === value}
                className={`combo-opt${i === active ? ' is-active' : ''}${o.tz === value ? ' is-current' : ''}`}
                onMouseDown={(e) => e.preventDefault()} /* keep focus so blur does not fire first */
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.tz)}
              >
                {o.label}
              </li>
            ))
          )}
          {searchingOnline && (
            <li className="combo-note" aria-hidden="true">
              City search by {CITY_LOOKUP_HOST}. Only what you typed is sent.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
