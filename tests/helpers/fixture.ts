// 結合テスト用の標準データ: チーム3つ、審査員2人、メンバー2人、審査員フォームと相互評価フォーム（公開中）
import type { Form, Question, Respondent, Team } from '../../src/shared/types';
import type { TestClient } from './app';

export interface Fixture {
  eventId: number;
  teams: { a: Team; b: Team; c: Team };
  judges: [Respondent, Respondent];
  memberA: Respondent;
  memberB: Respondent;
  judgeForm: Form;
  peerForm: Form;
  /** 審査員フォーム: 技術力(10点・重み2) / デザイン(10点・重み1) / 講評(任意) */
  jq: { tech: Question; design: Question; comment: Question };
  /** 相互評価フォーム: よかった度(5点) / また聞きたい?(ぜひ=2, まあ=1, うーん=0) */
  pq: { like: Question; again: Question };
}

export async function seed(client: TestClient): Promise<Fixture> {
  const event = await client.adminJson<{ id: number }>('POST', '/api/admin/events', {
    name: 'テスト発表会',
  });
  const eventId = event.id;

  const [a, b, c] = await client.adminJson<Team[]>('PUT', `/api/admin/events/${eventId}/teams`, {
    teams: [
      { name: 'A班', sortOrder: 1 },
      { name: 'B班', sortOrder: 2 },
      { name: 'C班', sortOrder: 3 },
    ],
  });

  const [j1, j2, memberA, memberB] = await client.adminJson<Respondent[]>(
    'PUT',
    `/api/admin/events/${eventId}/respondents`,
    {
      respondents: [
        { name: '審査員1', role: 'judge', teamId: null, sortOrder: 1 },
        { name: '審査員2', role: 'judge', teamId: null, sortOrder: 2 },
        { name: 'メンバーA', role: 'member', teamId: a.id, sortOrder: 3 },
        { name: 'メンバーB', role: 'member', teamId: b.id, sortOrder: 4 },
      ],
    },
  );

  const judgeForm = await client.adminJson<Form>('POST', '/api/admin/forms', {
    eventId,
    slug: 'judge',
    title: '審査員フォーム',
    descriptionMd: '',
    kind: 'judge',
  });
  const peerForm = await client.adminJson<Form>('POST', '/api/admin/forms', {
    eventId,
    slug: 'peer',
    title: '相互評価',
    descriptionMd: '',
    kind: 'peer',
  });

  const [tech, design, comment] = await client.adminJson<Question[]>(
    'PUT',
    `/api/admin/forms/${judgeForm.id}/questions`,
    {
      questions: [
        {
          sortOrder: 1,
          type: 'rating',
          labelMd: '技術力',
          options: null,
          maxScore: 10,
          weight: 2,
          required: true,
        },
        {
          sortOrder: 2,
          type: 'rating',
          labelMd: 'デザイン',
          options: null,
          maxScore: 10,
          weight: 1,
          required: true,
        },
        {
          sortOrder: 3,
          type: 'textarea',
          labelMd: '講評',
          options: null,
          maxScore: null,
          weight: 1,
          required: false,
        },
      ],
    },
  );
  const [like, again] = await client.adminJson<Question[]>(
    'PUT',
    `/api/admin/forms/${peerForm.id}/questions`,
    {
      questions: [
        {
          sortOrder: 1,
          type: 'rating',
          labelMd: 'よかった度',
          options: null,
          maxScore: 5,
          weight: 1,
          required: true,
        },
        {
          sortOrder: 2,
          type: 'choice',
          labelMd: 'また聞きたい?',
          options: [
            { label: 'ぜひ', score: 2 },
            { label: 'まあ', score: 1 },
            { label: 'うーん', score: 0 },
          ],
          maxScore: null,
          weight: 1,
          required: true,
        },
      ],
    },
  );

  await client.adminJson('PATCH', `/api/admin/forms/${judgeForm.id}`, { status: 'open' });
  await client.adminJson('PATCH', `/api/admin/forms/${peerForm.id}`, { status: 'open' });

  return {
    eventId,
    teams: { a, b, c },
    judges: [j1, j2],
    memberA,
    memberB,
    judgeForm: { ...judgeForm, status: 'open' },
    peerForm: { ...peerForm, status: 'open' },
    jq: { tech, design, comment },
    pq: { like, again },
  };
}

/** 審査員フォームへの回答を送る（技術力・デザインの点数だけ指定） */
export function submitJudge(
  client: TestClient,
  f: Fixture,
  respondentId: number,
  teamId: number,
  tech: number,
  design: number,
) {
  return client.request('POST', '/api/forms/judge/responses', {
    respondentId,
    teamId,
    answers: [
      { questionId: f.jq.tech.id, value: tech },
      { questionId: f.jq.design.id, value: design },
    ],
  });
}
