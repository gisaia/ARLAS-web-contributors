import { StringifiedTimeShortcut } from '../models/models';


export function getPredefinedTimeShortcuts(): Array<StringifiedTimeShortcut> {

    const predefinedTimeShortcuts = new Array<StringifiedTimeShortcut>();

    predefinedTimeShortcuts.push(
        { label: 'Today', from: 'now/d', to: 'now/d', type: 'absolute' },
        { label: 'This week', from: 'now/w', to: 'now/w', type: 'absolute' },
        { label: 'This month', from: 'now/M', to: 'now/M', type: 'absolute' },
        { label: 'This year', from: 'now/y', to: 'now/y', type: 'absolute' },

        { label: 'Today so far', from: 'now/d', to: 'now', type: 'round_relative' },
        { label: 'This week so far', from: 'now/w', to: 'now', type: 'round_relative' },
        { label: 'This month so far', from: 'now/M', to: 'now', type: 'round_relative' },
        { label: 'This year so far', from: 'now/y', to: 'now', type: 'round_relative' },

        { label: 'Last 15 minutes', from: 'now-15m', to: 'now', type: 'near_relative' },
        { label: 'Last 30 minutes', from: 'now-30m', to: 'now', type: 'near_relative' },
        { label: 'Last hour', from: 'now-1h', to: 'now', type: 'near_relative' },
        { label: 'Last 4 hours', from: 'now-4h', to: 'now', type: 'near_relative' },
        { label: 'Last 12 hours', from: 'now-12h', to: 'now', type: 'near_relative' },
        { label: 'Last 24 hours', from: 'now-24h', to: 'now', type: 'near_relative' },
        { label: 'Last 7 days', from: 'now-7d', to: 'now', type: 'near_relative' },

        { label: 'Last 30 days', from: 'now-30d', to: 'now', type: 'far_relative' },
        { label: 'Last 60 days', from: 'now-60d', to: 'now', type: 'far_relative' },
        { label: 'Last 90 days', from: 'now-90d', to: 'now', type: 'far_relative' },
        { label: 'Last 6 months', from: 'now-6M', to: 'now', type: 'far_relative' },
        { label: 'Last 1 year', from: 'now-1y', to: 'now', type: 'far_relative' }
    );
    let yearGroup = 0;
    const yearBegin = 1979;
    for (let i = 0; i < 100; i++) {
        const year = yearBegin + i;
        if (year % 5 === 0) {
            yearGroup = year;
        }
        const from = new Date();
        from.setUTCFullYear(year, 0, 1);
        from.setUTCHours(0, 0, 0);
        const to = new Date();
        to.setUTCFullYear(year, 11, 31);
        to.setUTCHours(23, 59, 59);
        predefinedTimeShortcuts.push({
            label: year.toString(),
            from: from.getTime().toString(),
            to: to.getTime().toString(),
            type: 'year'.concat('_').concat(yearGroup.toString())
        });
    }
    return predefinedTimeShortcuts;
}
