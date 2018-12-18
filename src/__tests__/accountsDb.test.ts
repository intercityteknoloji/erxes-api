import { accountFactory } from '../db/factories';
import { Accounts } from '../db/models';

describe('Accounts model test', () => {
  afterEach(async () => {
    // Clearing test data
    await Accounts.deleteMany({});
  });

  test('Create accounts', async () => {
    const account = await Accounts.createAccount({
      kind: 'fb',
      name: 'name',
      token: '123',
      tokenSecret: 'secret',
      uid: 'uids',
    });

    if (!account) {
      throw new Error('Account not found');
    }

    expect(account.kind).toBe('fb');
    expect(account.name).toBe('name');
    expect(account.token).toBe('123');
    expect(account.tokenSecret).toBe('secret');
    expect(account.uid).toBe('uids');

    const duplicate = await Accounts.createAccount({
      uid: 'uids',
      kind: 'asd',
      token: 'token',
      name: 'haHAA',
    });

    // if (!duplicate) {
    //   throw new Error('Account not found');
    // }

    expect(duplicate).toBeNull();
  });

  test('Remove Account', async () => {
    const account = await accountFactory({});

    await Accounts.removeAccount(account._id);

    const result = await Accounts.find({ _id: account._id });

    expect(result.length).toBe(0);
  });
});
