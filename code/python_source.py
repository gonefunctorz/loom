import math

SCALE = 3


def clamp(value, low, high):
    return max(low, min(high, value))


def weighted_root(value):
    return clamp(math.sqrt(value) * SCALE, 0, 20)
