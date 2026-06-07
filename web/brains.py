"""Dependency-free brains for the ReinLife live viewer.

These implement the same minimal interface the environment expects in test
mode: a ``method`` attribute (we reuse "DQN" so the env's action dispatch
calls ``get_action(state, epsilon)``) and a ``get_action`` method. No torch
required, so the simulation runs anywhere. Trained torch brains can be swapped
in later (Phase 3) through the same interface.
"""
import random
import numpy as np
from ReinLife.Models.utils import BasicBrain

# Action ids (see ReinLife/World/utils.py -> Actions)
UP, RIGHT, DOWN, LEFT, A_UP, A_RIGHT, A_DOWN, A_LEFT = range(8)
FOV = 7          # field-of-view side
C = FOV // 2     # center index (3,3)


class RandomBrain(BasicBrain):
    """Pure random policy."""
    method_name = "Random"

    def __init__(self):
        super().__init__(input_dim=153, output_dim=8, method="DQN")

    def get_action(self, state, n_epi=0):
        return random.randint(0, 7)

    def learn(self, **kwargs):
        pass


class HeuristicBrain(BasicBrain):
    """Hand-coded survival policy decoded from the observation vector.

    State layout (see Environment._get_observations):
        [0:49]    food    grid (food=0.5, superfood=1.0, poison=-1, else 0)
        [49:98]   health  grid
        [98:147]  kinship grid (+1 kin, -1 non-kin, 0 empty)
        [147:153] scalars
    Strategy: eat adjacent food -> attack adjacent non-kin -> step toward the
    nearest visible food (avoiding poison) -> otherwise wander.
    """
    method_name = "Heuristic"

    def __init__(self, aggression: float = 0.6):
        super().__init__(input_dim=153, output_dim=8, method="DQN")
        self.aggression = aggression

    def get_action(self, state, n_epi=0):
        state = np.asarray(state, dtype=float)
        food = state[0:49].reshape(FOV, FOV)
        kin = state[98:147].reshape(FOV, FOV)

        # neighbour offsets for the 4 move/attack directions
        nb = {UP: (C - 1, C), DOWN: (C + 1, C), LEFT: (C, C - 1), RIGHT: (C, C + 1)}

        # 1) adjacent food? step onto it (eat). superfood (1.0) preferred.
        adj_food = [(food[i, j], d) for d, (i, j) in nb.items() if food[i, j] > 0]
        if adj_food:
            return max(adj_food)[1]  # highest nutrition direction

        # 2) adjacent enemy? attack sometimes (gain health by killing).
        adj_enemy = [d for d, (i, j) in nb.items() if kin[i, j] == -1]
        if adj_enemy and random.random() < self.aggression:
            return {UP: A_UP, DOWN: A_DOWN, LEFT: A_LEFT, RIGHT: A_RIGHT}[random.choice(adj_enemy)]

        # 3) move toward nearest visible food, avoiding poison cells.
        ys, xs = np.where(food > 0)
        if len(ys):
            d2 = (ys - C) ** 2 + (xs - C) ** 2
            ty, tx = ys[np.argmin(d2)], xs[np.argmin(d2)]
            di, dj = ty - C, tx - C
            order = ([DOWN if di > 0 else UP] if abs(di) >= abs(dj) else []) + \
                    ([RIGHT if dj > 0 else LEFT]) + \
                    ([DOWN if di > 0 else UP] if abs(di) < abs(dj) else [])
            for d in order:
                ni, nj = nb[d]
                if food[ni, nj] != -1:      # don't walk into poison
                    return d
        # 4) wander
        return random.choice([UP, RIGHT, DOWN, LEFT])

    def learn(self, **kwargs):
        pass
