import math

def estimate_read_time_min(text: str, chars_per_min: int = 350) -> int:
    """대략적인 읽기 시간(분)을 추정한다.

    단순히 문자 수 / 분당 문자 처리량(기본 350자/분)으로 계산하며,
    최소 1분을 반환한다.

    Args:
        text: 원문 텍스트
        chars_per_min: 분당 읽는 문자 수 가정

    Returns:
        분 단위 정수(ceil)
    """
    return max(1, math.ceil(len(text) / max(1, chars_per_min)))