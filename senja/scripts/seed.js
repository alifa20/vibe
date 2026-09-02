/* Insert a few approved testimonials so the wall and embed have something to show. */
import { createTestimonial, setApproved } from '../src/db.js';

const samples = [
  {
    name: 'Ada Lovelace',
    role: 'Head of Analytics, Difference Engine Co.',
    rating: 5,
    text: 'We went from a spreadsheet nobody trusted to a dashboard the whole board reads on Monday morning. The migration took a fortnight, not the quarter we had budgeted.',
  },
  {
    name: 'Grace Hopper',
    role: 'CTO, Harbour Systems',
    rating: 5,
    text: 'They found the bug we had been chasing for three weeks in an afternoon, then wrote the regression test so it could never come back.',
  },
  {
    name: 'Rian Okafor',
    role: 'Founder, Palm & Pine',
    rating: 4,
    text: 'Straightforward to work with and genuinely fast. Our checkout conversion is up 18% since the redesign shipped.',
  },
  {
    name: 'Mei Tanaka',
    role: 'Ops Lead, Northwind Logistics',
    rating: 5,
    text: 'The thing I appreciated most was the honesty. We were talked out of a feature we did not need, which saved us about six weeks of build time.',
  },
  {
    name: 'Tomás Herrera',
    role: 'Product Manager, Cadence',
    rating: 5,
    text: 'Clear communication throughout, no surprises on the invoice, and the handover documentation was good enough that our own team picked it straight up.',
  },
  {
    name: 'Priya Raman',
    role: 'Marketing Director, Loomis',
    rating: 4,
    text: 'Responsive, careful, and unusually good at explaining trade-offs to non-technical stakeholders. We have already booked the next phase.',
  },
];

for (const sample of samples) {
  const id = createTestimonial({ ...sample, avatar: null, sourceIp: null });
  setApproved(id, true);
}

console.log(`Seeded ${samples.length} approved testimonials.`);
