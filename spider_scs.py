import requests


url = 'https://scs.sugon.com/prod/PM_sp_doa_Result.pml?1=1&clientstamp=1784010535191&doa_code=&service_uid=&customer_uid=&sugon_sn_multi=&contract=&declare_time=&declare_time2=&detail_problem=&problem_conclusion=&pageNo=1&pageSize=10000&target=PM_sp_doa_Result'



headers = {
    "cookie": "JSESSIONID=ACEC3C5243AACF60AFDC990F298423FF; Hm_lvt_3f6066478405c0cd17b8afc616d39f0d=1778290430; Hm_lvt_1a9cb0f7b49add36cf4656973d1e7a9c=1778290430; DP_Token=539a688d-7199-4016-8794-bbad354fc431"
}

response = requests.get(url, headers=headers)
print(response.text)