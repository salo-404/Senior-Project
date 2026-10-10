import { decodePayload, encodePayload } from './tier-request-payload';

describe('tier request payload', () => {
  it('round-trips the notes and requested skills', () => {
    const payload = { notes: 'More skills please', skill_ids: ['a', 'b'] };
    expect(decodePayload(encodePayload(payload))).toEqual(payload);
  });

  it('keeps the suggested flag for the nightly job', () => {
    expect(decodePayload(encodePayload({ notes: 'auto', skill_ids: [], suggested: true })).suggested).toBe(true);
  });

  it('reads plain text and empty values as notes only', () => {
    expect(decodePayload('HVAC certificate')).toEqual({ notes: 'HVAC certificate', skill_ids: [] });
    expect(decodePayload(null)).toEqual({ notes: '', skill_ids: [] });
    expect(decodePayload('{"not":"ours"}')).toEqual({ notes: '{"not":"ours"}', skill_ids: [] });
  });

  it('drops non-string skill ids', () => {
    expect(decodePayload('{"notes":"x","skill_ids":["a",5,null]}').skill_ids).toEqual(['a']);
  });
});
