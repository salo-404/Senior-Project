import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterTechnicianDto } from './technicians.dto';

const account = { email: 'a@b.co', password: 'password123', first_name: 'A', last_name: 'B' };
const application = {
  skills: [{ skill_id: '5b8a6a3e-8c1d-4a8e-9a77-2f1d3c4b5a69', proficiency_level: 4 }],
  years_of_experience: 5,
  bio: 'Five years repairing air conditioning units.',
  normal_rate: 30,
  emergency_rate: 50,
};

const errorsFor = async (body: object) => validate(plainToInstance(RegisterTechnicianDto, body));

describe('RegisterTechnicianDto', () => {
  it('accepts an account with a complete application', async () => {
    expect(await errorsFor({ ...account, application })).toHaveLength(0);
  });

  it('rejects a body without the application object (it must not reach the service)', async () => {
    const errors = await errorsFor(account);
    expect(errors.map((e) => e.property)).toContain('application');
  });

  it('rejects an application with no skills, a short bio, or a non-object value', async () => {
    expect((await errorsFor({ ...account, application: { ...application, skills: [] } })).length).toBeGreaterThan(0);
    expect((await errorsFor({ ...account, application: { ...application, bio: 'too short' } })).length).toBeGreaterThan(0);
    expect((await errorsFor({ ...account, application: 'nope' })).length).toBeGreaterThan(0);
  });
});
