// Host-owned round state. Peers receive views and never submit scores or phases.
export const TEAMS = ['red', 'blue'];
export const teamTarget = n => Number.isInteger(n) && n >= 1 && n <= 99 ? n : 16;
export class TeamMatch {
  constructor({ now = () => performance.now() / 1000, target = 16 } = {}) {
    this.now = now; this.target = teamTarget(target);
    this.scores = { red: 0, blue: 0 }; this.round = 0; this.phase = 'idle';
    this.winner = null; this.result = null; this.deadline = 0;
  }
  startRound() {
    this.round++; this.phase = 'freeze'; this.result = null; this.deadline = this.now() + 3;
  }
  tick(roster, players) {
    if (this.phase === 'over' || this.phase === 'idle') return;
    const teams = TEAMS.map(team => [...roster].filter(([, p]) => p.team === team));
    // A disconnected last teammate ends the match, including during intermission.
    if (teams.some(t => !t.length)) {
      this.winner = teams[0].length ? 'red' : teams[1].length ? 'blue' : null;
      this.result = 'forfeit'; this.phase = 'over'; return;
    }
    if (this.phase === 'freeze') {
      if (this.now() >= this.deadline) { this.phase = 'live'; this.deadline = this.now() + 120; }
      return;
    }
    if (this.phase === 'intermission') {
      if (this.now() >= this.deadline) this.startRound();
      return;
    }
    const alive = teams.map(ids => ids.map(([id]) => players.get(id)).filter(p => p?.hp > 0));
    if (alive.every(t => t.length) && this.now() < this.deadline) return;
    let winner = null;
    if (alive[0].length !== alive[1].length) winner = alive[0].length > alive[1].length ? 'red' : 'blue';
    else {
      const hp = alive.map(t => t.reduce((sum, p) => sum + p.hp, 0));
      if (Math.abs(hp[0] - hp[1]) > .01) winner = hp[0] > hp[1] ? 'red' : 'blue';
    }
    this.result = winner || 'draw';
    if (winner && ++this.scores[winner] >= this.target) {
      this.winner = winner; this.phase = 'over';
    } else { this.phase = 'intermission'; this.deadline = this.now() + 4; }
  }
  view() {
    return { round: this.round, phase: this.phase, scores: { ...this.scores }, target: this.target,
      left: Math.max(0, Math.ceil(this.deadline - this.now())), result: this.result, winner: this.winner,
      swapped: this.target > 1 && this.round > this.target - 1 };
  }
}
