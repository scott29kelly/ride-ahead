'use client';

import { useState } from 'react';
import type { BikeProfile } from '@/lib/types';

export interface FormValues {
  start: string;
  destinations: string[];
  profile: BikeProfile;
  roundTrip: boolean;
}

interface Props {
  onSubmit: (values: FormValues) => void;
  loading: boolean;
  initial?: Partial<FormValues>;
}

const PROFILE_LABELS: Record<BikeProfile, string> = {
  'cycling-regular': 'Everyday',
  'cycling-road': 'Road',
  'cycling-mountain': 'Mountain',
};

export function RouteForm({ onSubmit, loading, initial }: Props) {
  const [start, setStart] = useState(initial?.start ?? '');
  const [destinations, setDestinations] = useState<string[]>(
    initial?.destinations ?? ['', ''],
  );
  const [profile, setProfile] = useState<BikeProfile>(initial?.profile ?? 'cycling-regular');
  const [roundTrip, setRoundTrip] = useState(initial?.roundTrip ?? false);

  const update = (index: number, value: string) => {
    setDestinations((current) => current.map((entry, i) => (i === index ? value : entry)));
  };

  const filled = destinations.filter((value) => value.trim()).length;
  const canSubmit = start.trim().length > 0 && filled > 0 && !loading;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({ start, destinations: destinations.filter((value) => value.trim()), profile, roundTrip });
      }}
      className="space-y-4 rounded-xl bg-bark-900 p-5 ring-1 ring-bark-700"
    >
      <div>
        <label htmlFor="start" className="mb-1 block text-xs font-medium uppercase tracking-wide text-sand-400">
          Starting from
        </label>
        <input
          id="start"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          placeholder="Address, landmark, or 40.015, -105.280"
          className="w-full rounded-lg bg-bark-800 px-3 py-2 text-sand-200 ring-1 ring-bark-700 outline-none placeholder:text-sand-400/40 focus:ring-clay-400"
        />
      </div>

      <fieldset>
        <legend className="mb-1 block text-xs font-medium uppercase tracking-wide text-sand-400">
          Where to? Add up to three to compare
        </legend>
        <div className="space-y-2">
          {destinations.map((value, index) => (
            <input
              key={index}
              value={value}
              onChange={(event) => update(index, event.target.value)}
              placeholder={index === 0 ? 'First option' : `Option ${index + 1} (optional)`}
              aria-label={`Destination ${index + 1}`}
              className="w-full rounded-lg bg-bark-800 px-3 py-2 text-sand-200 ring-1 ring-bark-700 outline-none placeholder:text-sand-400/40 focus:ring-clay-400"
            />
          ))}
        </div>
        {destinations.length < 3 && (
          <button
            type="button"
            onClick={() => setDestinations((current) => [...current, ''])}
            className="mt-2 text-xs text-clay-400 hover:text-clay-500"
          >
            + Add another destination
          </button>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-lg bg-bark-800 p-1 ring-1 ring-bark-700">
          {(Object.keys(PROFILE_LABELS) as BikeProfile[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setProfile(option)}
              aria-pressed={profile === option}
              className={`rounded-md px-3 py-1 text-xs transition ${
                profile === option ? 'bg-clay-500 text-bark-950' : 'text-sand-400 hover:text-sand-200'
              }`}
            >
              {PROFILE_LABELS[option]}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-sand-400">
          <input
            type="checkbox"
            checked={roundTrip}
            onChange={(event) => setRoundTrip(event.target.checked)}
            className="size-4 accent-clay-500"
          />
          Round trip
        </label>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-clay-500 px-4 py-2.5 font-medium text-bark-950 transition hover:bg-clay-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'Scouting the routes…' : 'Preview these rides'}
      </button>
    </form>
  );
}
