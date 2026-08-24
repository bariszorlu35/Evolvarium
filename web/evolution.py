"""Selection layer: the rules that turn ReinLife's grid world into a world where
evolution actually *bites*.

The stock environment tops the population up with randomly spawned agents and
lets every adult reproduce on a flat 5% coin flip, so survival skill barely
affects how many offspring a lineage leaves. `EvoEnvironment` replaces those two
rules without touching the ReinLife core:

* **Reproduction is earned.** Only well-fed adults can breed, breeding costs
  health, and the chance scales with how well fed the parent is. A creature that
  forages (or hunts) well leaves more descendants — that is the selection
  gradient the whole project depends on.
* **Offspring inherit from their actual parent**, optionally recombined with a
  nearby mate of the same family, then mutated. The stock code re-used a shared
  family brain, which erased individual variation.
* **Random spawning is a rescue, not a subsidy.** New founders only appear when
  the world is nearly empty, so a thriving population is a *result*, not a gift.
* **Lifetime bookkeeping** (food eaten, poison taken, kills, offspring,
  generation, lineage) gives an honest fitness score and makes the evolutionary
  story visible in the UI.
"""
import random
import numpy as np

from ReinLife.World.environment import Environment
from ReinLife.World.entities import Agent, Food, Poison, SuperFood
from web import neuro

# --- reproduction rules -------------------------------------------------------
REPRO_MIN_AGE = 5          # must be an adult
REPRO_MIN_HEALTH = 0.50    # fraction of max health needed to breed at all
REPRO_COST = 50            # health the parent spends on the offspring
NEWBORN_HEALTH = 110       # what the offspring starts life with
REPRO_MAX_CHANCE = 0.30    # per-step chance for a perfectly fed adult
MATE_CHANCE = 0.65         # probability of recombining with a nearby mate

# --- rescue rules -------------------------------------------------------------
RESCUE_FRACTION = 0.06     # below this share of max_agents the world reseeds
RESCUE_MIN = 4
FOUNDERS_PER_FAMILY = 5    # a lone founding pair is too fragile to test a niche

# A whole way of life can be lost to bad luck, and once the diet valley opens up
# between the two morphs it is very hard to cross back: a half-carnivore is bad
# at both jobs. Without this, a world that loses its predators stays predatorless
# for good, which is not the open-ended ecosystem the project claims to be. If a
# niche has stood empty for a long while, a few founders arrive from elsewhere.
NICHE_ABSENT_TICKS = 150
NICHE_MIN = 2              # fewer than this counts as gone: a single short-lived
                           # mutant should not reset the clock on a lost niche
IMMIGRANTS = 5             # a lone pair rarely establishes; a small group does

# --- productivity -------------------------------------------------------------
# A creature burns 10 health per step and a plant is worth 40, so it must eat
# roughly once every four steps to break even. The stock world only kept plants
# on ~7% of cells, which is below that break-even line: nothing could feed
# itself, the population collapsed, and the random-spawn subsidy was the only
# reason the world looked alive. These densities are maintained every tick.
FOOD_DENSITY = 0.16
POISON_DENSITY = 0.035
REGROW_PER_TICK = 14       # cap on new plants per tick, so scarcity is gradual

# --- the food chain -----------------------------------------------------------
# In the stock world a plant fed everyone equally and a kill paid a flat bonus,
# so hunting was strictly worse than grazing: every carnivore lineage drifted
# back to herbivory within a few dozen generations and the predator layer died
# out. Nutrition here depends on what a creature *is*. Specialising pays, and a
# diet stuck halfway is the worst of both worlds — which is what splits the
# population into two stable morphs instead of one grey average.
PLANT_NUTRITION = 50       # a competent forager runs a surplus, a poor one starves
BASE_HEALTH = 200          # what a pure herbivore can hold
GORGE_CAPACITY = 120       # extra reserve a pure carnivore can bank from a kill
MEAT_NUTRITION = 170       # a successful hunt must clearly beat grazing, or
                           # the predator niche sits exactly at break-even and
                           # drifts to extinction on noise alone
POISON_DAMAGE = 40
DIET_PENALTY = 0.85        # how much of a plant's value a pure carnivore loses


def plant_value(diet):
    """What a plant is worth to a creature with this diet."""
    return PLANT_NUTRITION * (1.0 - DIET_PENALTY * diet)


def meat_value(diet):
    """What a kill is worth. A pure herbivore can defend itself but barely
    profits from it; a specialist predator lives off it."""
    return MEAT_NUTRITION * (0.15 + 0.85 * diet)


def fitness(a) -> float:
    """Lifetime reproductive success, with the behaviours that lead to it.

    ReinLife's built-in `agent.fitness` is a reinforcement-learning reward built
    from *kinship ratios*, so a creature in a large family scores highly without
    doing anything well. For evolution we want the opposite: what did this
    individual actually achieve?
    """
    return (10.0 * getattr(a, "offspring", 0)
            + 1.0 * a.age
            + 2.0 * getattr(a, "eaten", 0)
            + 4.0 * getattr(a, "kills", 0)
            + 5.0 * max(0, getattr(a, "super_eaten", 0))
            - 3.0 * getattr(a, "poisoned", 0))


def capacity(diet):
    """How much health a creature can bank.

    A kill is worth far more than a plant, so with one capacity for everyone a
    predator threw most of a carcass away against the health ceiling and its
    real income was a fraction of what the food chain promised. Predators gorge
    and then fast; grazers top up constantly and need no reserve.
    """
    return int(BASE_HEALTH + GORGE_CAPACITY * diet)


def attach(a, genome, generation=0, lineage=None, parent=None):
    """Give an agent its heritable genome, its capacity, and the counters."""
    a.genome = genome
    a.max_health = capacity(genome["diet"])
    a.health = min(a.health, a.max_health)
    a.prev_action = None
    a.generation = int(generation)
    a.lineage = int(lineage if lineage is not None else getattr(a, "uid", 0))
    a.parent_uid = int(parent) if parent is not None else None
    a.eaten = 0
    a.poisoned = 0
    a.super_eaten = 0
    a.kills = 0
    a.offspring = 0
    a.born_tick = 0
    return a


class EvoEnvironment(Environment):
    """ReinLife's Environment with earned reproduction and honest inheritance.

    Parameters (beyond the base class):
    -----------------------------------
    mut_sigma : float
        World mutation rate; each lineage scales it by its own evolved `mrate`.
    seed_fn : callable(role) -> genome
        Produces a founder genome for a family role ("herb" / "carn").
    role_of : dict[int, str]
        Maps a family gene id to its founding role.
    """

    def __init__(self, *args, mut_sigma=0.08, seed_fn=None, role_of=None,
                 food_density=FOOD_DENSITY, poison_density=POISON_DENSITY,
                 founders_per_family=FOUNDERS_PER_FAMILY, **kwargs):
        super().__init__(*args, **kwargs)
        self.founders_per_family = founders_per_family
        self.food_density = food_density
        self.poison_density = poison_density
        self.mut_sigma = mut_sigma
        self.seed_fn = seed_fn or (lambda role: neuro.seed_genome(role))
        self.role_of = role_of or {}
        self.tick = 0
        self.births = 0
        self.deaths = 0
        self.rescues = 0
        self.immigrations = 0
        self.role_absent = {"herb": 0, "carn": 0}
        self.max_generation = 0
        self._uid = 0

    # -- world creation ---------------------------------------------------------
    def reset(self):
        """Start the world with a real founding population.

        The stock reset drops exactly one creature per family. Two lone
        carnivores in a thousand empty cells almost never meet prey before they
        starve, so the predator niche used to be decided by luck in the first
        thirty ticks rather than by whether hunting works. A handful of founders
        per family gives every strategy a fair trial.
        """
        self.tick = 0
        self.births = self.deaths = self.rescues = self.immigrations = 0
        self.role_absent = {"herb": 0, "carn": 0}
        self.max_generation = 0
        self._uid = 0
        super().reset()
        for gene in range(len(self.brains)):
            for _ in range(max(0, self.founders_per_family - 1)):
                self._add_agent(random_loc=True, brain=self.brains[gene], gene=gene)
        self.agents = self.grid.get_entities(self.entities.agent)
        self.adopt()
        self._get_observations()
        self._update_agents_state()

    # -- identity --------------------------------------------------------------
    def next_uid(self):
        self._uid += 1
        return self._uid

    def adopt(self, agents=None):
        """Make sure every agent on the grid has a uid, a genome and counters.

        Agents can appear from code paths we do not control, so this is the
        single funnel that guarantees the invariant `every agent has a genome`.
        """
        for a in (self.agents if agents is None else agents):
            if not hasattr(a, "uid"):
                a.uid = self.next_uid()
            if getattr(a, "genome", None) is None:
                attach(a, self.seed_fn(self.role_of.get(a.gene, "herb")),
                       generation=0, lineage=a.uid)
                a.born_tick = self.tick
            g = getattr(a, "generation", 0)
            if g > self.max_generation:
                self.max_generation = g

    # -- selection -------------------------------------------------------------
    def _repro_chance(self, agent) -> float:
        hf = agent.health / max(1, agent.max_health)
        if hf < REPRO_MIN_HEALTH:
            return 0.0
        return REPRO_MAX_CHANCE * (hf - REPRO_MIN_HEALTH) / (1.0 - REPRO_MIN_HEALTH)

    def _find_mate(self, agent):
        """A nearby adult of the same family — the other half of a recombination."""
        best, bd = None, 99
        for o in self.agents:
            if o is agent or o.dead or getattr(o, "genome", None) is None:
                continue
            if o.gene != agent.gene or o.age <= REPRO_MIN_AGE:
                continue
            d = abs(o.i - agent.i) + abs(o.j - agent.j)
            if d < bd:
                bd, best = d, o
        return best if bd <= 4 else None

    def _reproduce(self):
        """Well-fed adults pay health to produce a mutated copy of themselves."""
        self.adopt()
        for agent in list(self.agents):
            if agent.dead or agent.age <= REPRO_MIN_AGE:
                continue
            if len(self.agents) > self.max_agents:
                break
            if self.limit_reproduction and agent.reproduced:
                continue
            if random.random() >= self._repro_chance(agent):
                continue

            mate = self._find_mate(agent) if random.random() < MATE_CHANCE else None
            if mate is not None:
                child_genome = neuro.breed(agent.genome, mate.genome, self.mut_sigma)
            else:
                child_genome = neuro.mutate(agent.genome, self.mut_sigma)

            # Herbivores herd, predators disperse. Offspring are born beside
            # their parent, which makes families cluster — and a cluster is a
            # problem for a predator, whose neighbours are then all kin it will
            # not attack. Grazers gain from the same crowding. So dispersal is
            # diet-dependent: a pure carnivore's young always strike out on
            # their own, a pure herbivore's young stay in the herd.
            coordinates = None
            if random.random() >= agent.genome["diet"]:
                coordinates = self._get_empty_within_fov(agent)
            if coordinates:
                child = self._add_agent(coordinates=random.choice(coordinates),
                                        brain=self.brains[agent.gene], gene=agent.gene)
            else:
                child = self._add_agent(random_loc=True,
                                        brain=self.brains[agent.gene], gene=agent.gene)
            if child is None:
                continue

            child.uid = self.next_uid()
            attach(child, child_genome,
                   generation=getattr(agent, "generation", 0) + 1,
                   lineage=getattr(agent, "lineage", agent.uid),
                   parent=agent.uid)
            child.born_tick = self.tick
            child.health = min(child.max_health, NEWBORN_HEALTH)

            agent.health = max(1.0, agent.health - REPRO_COST)
            agent.offspring = getattr(agent, "offspring", 0) + 1
            self.births += 1
            self.max_generation = max(self.max_generation, child.generation)
            self.agents.append(child)
            if self.limit_reproduction:
                agent.reproduced = True

    def _produce(self):
        """Reseed founders only when the world is (nearly) empty.

        The stock implementation spawned a fresh agent on 5% of *all* steps,
        which quietly propped the population up and diluted selection. Here it
        is strictly a recovery mechanism, and each use is counted so the UI can
        show honestly that the world had to be rescued.
        """
        floor = max(RESCUE_MIN, int(self.max_agents * RESCUE_FRACTION))
        alive = len([a for a in self.agents if not a.dead])
        if alive >= floor:
            return
        genes = {a.gene for a in self.agents if not a.dead}
        missing = [g for g in range(len(self.brains)) if g not in genes]
        for _ in range(min(2, floor - alive)):
            gene = random.choice(missing) if missing else random.randrange(len(self.brains))
            if self._found(gene) is not None:
                self.rescues += 1
                if gene in missing:
                    missing.remove(gene)

    def _found(self, gene):
        """Drop a brand-new founder of one family onto the grid."""
        a = self._add_agent(random_loc=True, brain=self.brains[gene], gene=gene)
        if a is None:
            return None
        a.uid = self.next_uid()
        attach(a, self.seed_fn(self.role_of.get(gene, "herb")), generation=0, lineage=a.uid)
        a.born_tick = self.tick
        self.agents.append(a)
        return a

    def _immigrate(self):
        """Refill a niche that has stood empty long enough to be considered lost.

        Returns the number of arrivals. This runs *after* `update_env`, which is
        where observations are built, so any arrival has to have its senses wired
        up before the next tick asks it to decide something.
        """
        arrived = 0
        live = [a for a in self.agents if not a.dead and getattr(a, "genome", None)]
        if len(live) < max(RESCUE_MIN, int(self.max_agents * RESCUE_FRACTION)):
            return arrived             # the whole world is struggling; rescue handles it
        present = {"herb": 0, "carn": 0}
        for a in live:
            present["carn" if neuro.is_carnivore(a.genome) else "herb"] += 1

        for role, count in present.items():
            if count >= NICHE_MIN:
                self.role_absent[role] = 0
                continue
            self.role_absent[role] += 1
            if self.role_absent[role] < NICHE_ABSENT_TICKS:
                continue
            genes = [g for g, r in self.role_of.items() if r == role] or [0]
            for _ in range(IMMIGRANTS):
                if self._found(random.choice(genes)) is not None:
                    arrived += 1
            self.role_absent[role] = 0
            self.immigrations += 1

        if arrived:
            self.agents = self.grid.get_entities(self.entities.agent)
            self.adopt()
            self._get_observations()
            self._update_agents_state()
        return arrived

    # -- productivity -----------------------------------------------------------
    def _add_food(self):
        """Regrow plants toward a target density.

        The stock rule only topped food up in three coin-flips once the grid had
        already fallen below 10% cover, which left the world below the metabolic
        break-even point. Here the world has a carrying capacity: plants regrow
        toward `food_density` a few per tick, so grazing pressure genuinely
        depletes a region and creatures have to move to find more.
        """
        grid = self.grid.get_numpy()
        cells = self.width * self.height

        want = int(cells * self.food_density) - int((grid == self.entities.food).sum())
        for _ in range(min(REGROW_PER_TICK, max(0, want))):
            self.grid.set_random(Food, p=1)

        want = int(cells * self.poison_density) - int((grid == self.entities.poison).sum())
        for _ in range(min(3, max(0, want))):
            self.grid.set_random(Poison, p=1)

        if not (grid == self.entities.super_food).any():
            self.grid.set_random(SuperFood, p=1)

    def add_food(self, n):
        """Manual top-up (the viewer's 'add plants' button)."""
        added = 0
        for _ in range(int(n)):
            if self.grid.set_random(Food, p=1) is not None:
                added += 1
        return added

    # -- the food chain ---------------------------------------------------------
    def _eat(self, agent: Agent):
        """Plants feed herbivores; they are nearly worthless to a specialist
        predator. Poison hurts everyone equally."""
        cell = self.grid.grid[agent.i_target, agent.j_target].entity_type
        diet = agent.genome["diet"] if getattr(agent, "genome", None) else 0.0

        if cell == self.entities.food:
            agent.health = min(agent.max_health, agent.health + plant_value(diet))
            agent.eaten = getattr(agent, "eaten", 0) + 1
        elif cell == self.entities.poison:
            agent.health = min(agent.max_health, agent.health - POISON_DAMAGE)
            agent.poisoned = getattr(agent, "poisoned", 0) + 1
        elif cell == self.entities.super_food:
            agent.health = min(agent.max_health, agent.health + plant_value(diet) + 20)
            agent.max_age = int(agent.max_age * 1.2)
            agent.ate_super_food = 1.
            agent.eaten = getattr(agent, "eaten", 0) + 1
            agent.super_eaten = getattr(agent, "super_eaten", 0) + 1

    def _attack(self):
        """Run the stock attack resolution, then re-price the meat by diet.

        `Agent.execute_attack` hands every killer a flat +100. We record health
        beforehand and restate the gain, skipping any attacker that was itself
        killed in the same exchange (its health is 0 and must stay there).
        """
        before = {id(a): a.health for a in self.agents}
        super()._attack()
        for agent in self.agents:
            if not agent.killed:
                continue
            agent.kills = getattr(agent, "kills", 0) + 1
            if agent.health <= 0:
                continue                      # killed in the same exchange
            diet = agent.genome["diet"] if getattr(agent, "genome", None) else 0.0
            agent.health = min(agent.max_health,
                               before[id(agent)] + meat_value(diet))

    def _remove_dead_agents(self):
        self.deaths += sum(1 for a in self.agents if a.dead)
        super()._remove_dead_agents()

    # -- one whole tick ---------------------------------------------------------
    def evolve_step(self, policy):
        """Advance the world one tick. `policy(agent) -> action id`.

        Returns the list of agents that died this tick, so the caller can retire
        them into a hall of fame before they are swept off the grid.
        """
        self.adopt()
        for a in self.agents:
            if a.state is None:        # never let an unwired creature reach a policy
                a.state = a.state_prime if a.state_prime is not None else np.zeros(153)
            a.action = policy(a)
            a.prev_action = a.action
        self.step()
        dead = [a for a in self.agents if a.dead]
        self.update_env()
        self._immigrate()
        self.adopt()
        self.tick += 1
        return dead
