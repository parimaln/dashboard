import { describe, expect, it } from 'vitest';
import ical from 'node-ical';
import { parseSources, expandEvents } from '../server.js';

describe('parseSources', () => {
  it('parses a single url|label|colour triple', () => {
    const [source] = parseSources('https://example.com/a.ics|Family|#f2b544');
    expect(source).toEqual({ url: 'https://example.com/a.ics', label: 'Family', colour: '#f2b544' });
  });

  it('parses several sources', () => {
    const sources = parseSources(
      'https://example.com/a.ics|Family|#f2b544, https://example.com/b.ics|Work|#4f9cf9',
    );
    expect(sources).toHaveLength(2);
    expect(sources[1]?.label).toBe('Work');
  });

  it('does not split on commas inside a url query string', () => {
    // Google's secret ICS urls can contain commas; splitting on every comma would
    // silently truncate the feed url and the calendar would just never load.
    const sources = parseSources('https://example.com/a.ics?ids=one,two,three|Family|#f2b544');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe('https://example.com/a.ics?ids=one,two,three');
  });

  it('falls back to a default label and colour', () => {
    const [source] = parseSources('https://example.com/a.ics');
    expect(source?.label).toBe('Calendar 1');
    expect(source?.colour).toBe('#4f9cf9');
  });

  it('rejects a malformed entry with an actionable message', () => {
    expect(() => parseSources('not-a-url|Family|#f2b544')).toThrow(/CALENDAR_ICS_URLS entry 1/);
  });
});

const SOURCE = { url: 'https://example.com/a.ics', label: 'Family', colour: '#f2b544' };

function ics(body: string): Record<string, ical.CalendarComponent> {
  return ical.sync.parseICS(
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', body, 'END:VCALENDAR'].join('\r\n'),
  );
}

describe('expandEvents', () => {
  const windowStart = new Date('2026-09-01T00:00:00Z');
  const windowEnd = new Date('2026-12-01T00:00:00Z');

  it('returns a single timed event', () => {
    const events = expandEvents(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:one',
          'DTSTART:20260903T090000Z',
          'DTEND:20260903T100000Z',
          'SUMMARY:Dentist',
          'LOCATION:Sandvika',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      SOURCE,
      windowStart,
      windowEnd,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Dentist', location: 'Sandvika', calendar: 'Family', allDay: false });
  });

  it('marks date-only events as all day', () => {
    const events = expandEvents(
      ics(['BEGIN:VEVENT', 'UID:two', 'DTSTART;VALUE=DATE:20260905', 'DTEND;VALUE=DATE:20260906', 'SUMMARY:Holiday', 'END:VEVENT'].join('\r\n')),
      SOURCE,
      windowStart,
      windowEnd,
    );
    expect(events[0]?.allDay).toBe(true);
  });

  it('expands a weekly recurrence across the window', () => {
    const events = expandEvents(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:three',
          'DTSTART:20260903T170000Z',
          'DTEND:20260903T180000Z',
          'RRULE:FREQ=WEEKLY;COUNT=6',
          'SUMMARY:Swimming',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      SOURCE,
      windowStart,
      windowEnd,
    );
    expect(events).toHaveLength(6);
    expect(new Set(events.map((e) => e.title))).toEqual(new Set(['Swimming']));
  });

  it('honours EXDATE so a cancelled occurrence disappears', () => {
    const events = expandEvents(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:four',
          'DTSTART:20260903T170000Z',
          'DTEND:20260903T180000Z',
          'RRULE:FREQ=WEEKLY;COUNT=4',
          'EXDATE:20260910T170000Z',
          'SUMMARY:Swimming',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      SOURCE,
      windowStart,
      windowEnd,
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.start.slice(0, 10))).not.toContain('2026-09-10');
  });

  it('excludes occurrences outside the window', () => {
    const events = expandEvents(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:five',
          'DTSTART:20260903T170000Z',
          'DTEND:20260903T180000Z',
          'RRULE:FREQ=WEEKLY;COUNT=100',
          'SUMMARY:Swimming',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      SOURCE,
      windowStart,
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(events.length).toBeLessThan(6);
    for (const event of events) {
      expect(new Date(event.start).getTime()).toBeLessThanOrEqual(new Date('2026-10-01T00:00:00Z').getTime());
    }
  });

  it('ignores non-event components', () => {
    const events = expandEvents(
      ics(['BEGIN:VTODO', 'UID:todo', 'SUMMARY:Not an event', 'END:VTODO'].join('\r\n')),
      SOURCE,
      windowStart,
      windowEnd,
    );
    expect(events).toHaveLength(0);
  });

  it('carries the source colour onto every event', () => {
    const events = expandEvents(
      ics(['BEGIN:VEVENT', 'UID:six', 'DTSTART:20260903T090000Z', 'DTEND:20260903T100000Z', 'SUMMARY:X', 'END:VEVENT'].join('\r\n')),
      SOURCE,
      windowStart,
      windowEnd,
    );
    expect(events[0]?.colour).toBe('#f2b544');
  });
});
