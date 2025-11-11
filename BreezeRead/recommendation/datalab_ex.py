import os
import urllib.request
import json
import pandas as pd
import matplotlib.pyplot as plt
from dotenv import load_dotenv
load_dotenv()

# 한글 폰트 설정 (그래프 깨짐 방지)
plt.rc('font', family='Hiragino Sans GB W3')
# 연령대 코드 → 설명 변환용 딕셔너리
age_conv = {
    '1': '0∼12세', '2': '13∼18세', '3': '19∼24세', '4': '25∼29세',
    '5': '30∼34세', '6': '35∼39세', '7': '40∼44세', '8': '45∼49세',
    '9': '50∼54세', '10': '55∼59세', '11': '60세 이상'
}

# ✅ 네이버 데이터랩 API 호출 함수
def getresult(startDate, endDate, timeUnit, keywordGroups, device, gender, ages):
    url = "https://openapi.naver.com/v1/datalab/search"
    response_results_all = pd.DataFrame()

    for age in ages:
        body_dict = {
            "startDate": startDate,
            "endDate": endDate,
            "timeUnit": timeUnit,
            "keywordGroups": keywordGroups,
            "device": device,
            "gender": gender,
            "ages": [age]
        }
        body=str(body_dict).replace("'",'"') 
        request = urllib.request.Request(url)
        request.add_header("X-Naver-Client-Id",client_id)
        request.add_header("X-Naver-Client-Secret",client_secret)
        request.add_header("Content-Type","application/json")
        response = urllib.request.urlopen(request, data=body.encode("utf-8"))
        rescode = response.getcode()
        if(rescode==200):
            response_body = response.read()
            response_json = json.loads(response_body)
        else:
            print("Error Code:" + rescode)
         # 결과데이터중 'data' 와 'title'만 따로 DataFrame으로 저장
        response_results = pd.DataFrame()
        for data in response_json['results']:
            result=pd.DataFrame(data['data'])
            result['title']=data['title']
            result['age']=age # 연령대 정보를 추가

            response_results = pd.concat([response_results,result])
        
        response_results_all = pd.concat([response_results_all,response_results])
        
    titles = response_results_all['title'].unique()

    for age in ages:
        plt.figure(figsize=(4,1))
        for title in titles:
            data=response_results_all.loc[(response_results_all['title']==title) 
                        & (response_results_all['age']==age),:]
            plt.plot(data['period'],data['ratio'],label=title)
            plt.xticks(rotation=90)
            plt.legend()
        plt.title(str(age_conv[age]))
        plt.show()



startDate='2022-01-01'
endDate='2022-09-30'
timeUnit='month'  #'day','week','month'
keywordGroups=[
    {'groupName':'경복궁', 'keywords':['경복궁','야간개장','주차','티켓']},
    {'groupName':'제주도', 'keywords':['제주도','맛집','브이패스']},
]
device='pc'  #'pc','mo'
gender='f'   #'m','f'
ages=['1','2','3','4','5','6','7','8','9','10','11']  # #1: 0∼12세, 2: 13∼18세, 3: 19∼24세, 4: 25∼29세, 
#5: 30∼34세, 6: 35∼39세, 7: 40∼44세, 8: 45∼49세, 9: 50∼54세, 10: 55∼59세, 11: 60세 이상


getresult(startDate,endDate,timeUnit,keywordGroups,device,gender,ages)