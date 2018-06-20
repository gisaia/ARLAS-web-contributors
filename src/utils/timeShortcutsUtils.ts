import { StringifiedTimeShortcut } from '../models/models';

export function getPredefinedTimeShortcuts(): Array<StringifiedTimeShortcut> {
    return [
        {label: 'Today', from: 'now/d', to: 'now/d', type: 'absolute'},
        {label: 'This week', from: 'now/w', to: 'now/w', type: 'absolute'},
        {label: 'This month', from: 'now/M', to: 'now/M', type: 'absolute'},
        {label: 'This year', from: 'now/y', to: 'now/y', type: 'absolute'},

        {label: 'Today so far', from: 'now/d', to: 'now', type: 'round_relative'},
        {label: 'This week so far', from: 'now/w', to: 'now', type: 'round_relative'},
        {label: 'This month so far', from: 'now/M', to: 'now', type: 'round_relative'},
        {label: 'This year so far', from: 'now/y', to: 'now', type: 'round_relative'},

        {label: 'Last 15 minutes', from: 'now-15m', to: 'now', type: 'near_relative'},
        {label: 'Last 30 minutes', from: 'now-30m', to: 'now', type: 'near_relative'},
        {label: 'Last hour', from: 'now-1h', to: 'now', type: 'near_relative'},
        {label: 'Last 4 hours', from: 'now-4h', to: 'now', type: 'near_relative'},
        {label: 'Last 12 hours', from: 'now-12h', to: 'now', type: 'near_relative'},
        {label: 'Last 24 hours', from: 'now-24h', to: 'now', type: 'near_relative'},
        {label: 'Last 7 days', from: 'now-7d', to: 'now', type: 'near_relative'},

        {label: 'Last 30 days', from: 'now-30d', to: 'now', type: 'far_relative'},
        {label: 'Last 60 days', from: 'now-60d', to: 'now', type: 'far_relative'},
        {label: 'Last 90 days', from: 'now-90d', to: 'now', type: 'far_relative'},
        {label: 'Last 6 months', from: 'now-6M', to: 'now', type: 'far_relative'},
        {label: 'Last 1 year', from: 'now-1y', to: 'now', type: 'far_relative'}
    ];
}
