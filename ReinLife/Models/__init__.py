# Torch is optional: the NN-based brains require it, but the environment and
# lightweight (e.g. random/heuristic) brains do not. Guard the imports so the
# package is usable without torch installed.
try:
    from ReinLife.Models.D3QN import D3QNAgent as D3QN
    from ReinLife.Models.DQN import DQNAgent as DQN
    from ReinLife.Models.PERDQN import PERDQNAgent as PERDQN
    from ReinLife.Models.PERD3QN import PERD3QNAgent as PERD3QN
    from ReinLife.Models.PPO import PPOAgent as PPO
    TORCH_AVAILABLE = True
except ModuleNotFoundError as _e:
    import warnings as _warnings
    _warnings.warn(f"ReinLife: torch-based brains unavailable ({_e}). "
                   "Install torch to use DQN/D3QN/PERDQN/PERD3QN/PPO.")
    TORCH_AVAILABLE = False
