import { describe, expect, it } from 'vitest';
import { getFieldValue } from './utils';

const data = {
  collection: 'main',
  properties: {
    datetime: 1751367379,
    '123_test': true
  }
};

describe('getFieldValue', () => {
  it('Can parse using a key', () => {
    expect(getFieldValue('collection', data)).to.eq(data.collection);
  });

  it('Can parse using a key containing a dot', () => {
    expect(getFieldValue('properties.datetime', data)).to.eq(data.properties.datetime);
  });

  it('Can parse using a key containing a number', () => {
    expect(getFieldValue('properties.123_test', data)).to.eq(data.properties['123_test']);
  });
});
